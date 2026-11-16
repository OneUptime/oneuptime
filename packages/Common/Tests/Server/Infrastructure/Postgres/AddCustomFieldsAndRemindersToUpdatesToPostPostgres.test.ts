import { AddCustomFieldsAndRemindersToUpdatesToPost1809182480026 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182480026-AddCustomFieldsAndRemindersToUpdatesToPost";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import NotificationRuleUpdates from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddCustomFieldsAndRemindersToUpdatesToPost migration against a real
 * Postgres, on real rows (#7937, #7938): an incident or alert rule that
 * ticked Other edits gets Custom field changes ticked, and an incident,
 * alert or maintenance rule that ticked Everything else gets Reminders -
 * every other part of its JSON as it was. A rule with no list (every
 * update), one that ticked neither box, one of another kind (an episode's,
 * a security case's) and a list that is not a list are left as they are.
 * Run twice, the second run changes nothing; its down takes both boxes out
 * again.
 *
 * Opt in with RUN_POSTGRES_UPDATES_TO_POST_MIGRATION_TESTS=true and the
 * normal database credentials; UPDATES_TO_POST_MIGRATION_TEST_DATABASE_HOST
 * / _PORT / _NAME point it at a database other than the local development
 * one. It needs no migrations: the table the migration writes is made, with
 * the two columns it reads, in a uniquely named schema that is dropped
 * afterwards, so no other row is read or written.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_UPDATES_TO_POST_MIGRATION_TESTS"] === "true"
    ? describe
    : describe.skip;

interface RuleSeed {
  label: string;
  eventType: string;
  // The rule's JSON as stored before the upgrade.
  notificationRule: JSONObject;
  // updatesToPost after it: undefined when the rule has none.
  expected: unknown;
}

function id(): string {
  return ObjectID.generate().toString();
}

// The rest of a rule's JSON, which the migration must keep as it is.
const REST: JSONObject = {
  _type: "IncidentNotificationRule",
  filterCondition: "All",
  filters: [{ checkOn: "Incident Title", conditionType: "Contains" }],
  shouldPostToExistingChannel: true,
  existingChannelNames: "executive-alerts",
};

const SEEDS: Array<RuleSeed> = [
  {
    label: "an incident rule with Other edits and Everything else",
    eventType: "Incident",
    notificationRule: {
      ...REST,
      updatesToPost: ["PrivateNotes", "Edits", "Other"],
    },
    expected: ["PrivateNotes", "Edits", "Other", "CustomFields", "Reminders"],
  },
  {
    label: "an alert rule with Other edits only",
    eventType: "Alert",
    notificationRule: { ...REST, updatesToPost: ["Edits"] },
    expected: ["Edits", "CustomFields"],
  },
  {
    label: "an alert rule with Everything else only",
    eventType: "Alert",
    notificationRule: { ...REST, updatesToPost: ["Paging", "Other"] },
    expected: ["Paging", "Other", "Reminders"],
  },
  {
    label: "a maintenance rule with Everything else",
    eventType: "Scheduled Maintenance",
    notificationRule: { ...REST, updatesToPost: ["StateChanges", "Other"] },
    expected: ["StateChanges", "Other", "Reminders"],
  },
  {
    label: "an incident rule of Key updates only: neither box",
    eventType: "Incident",
    notificationRule: {
      ...REST,
      updatesToPost: [
        "ResolvedAndReopened",
        "SeverityChanges",
        "PublicNotes",
        "Postmortem",
      ],
    },
    expected: [
      "ResolvedAndReopened",
      "SeverityChanges",
      "PublicNotes",
      "Postmortem",
    ],
  },
  {
    label: "an incident rule with nothing ticked",
    eventType: "Incident",
    notificationRule: { ...REST, updatesToPost: [] },
    expected: [],
  },
  {
    label: "an incident rule that posts every update: no list",
    eventType: "Incident",
    notificationRule: { ...REST },
    expected: undefined,
  },
  {
    label: "an incident rule that ticked the new box already",
    eventType: "Incident",
    notificationRule: { ...REST, updatesToPost: ["Reminders", "Other"] },
    expected: ["Reminders", "Other"],
  },
  {
    label: "an incident episode rule with Everything else: it has no reminders",
    eventType: "Incident Episode",
    notificationRule: { ...REST, updatesToPost: ["Other"] },
    expected: ["Other"],
  },
  {
    label: "a maintenance rule's Other edits: its edits are not posted",
    eventType: "Scheduled Maintenance",
    notificationRule: { ...REST, updatesToPost: ["Edits"] },
    expected: ["Edits"],
  },
  {
    label: "a list typed by hand that is not a list",
    eventType: "Incident",
    notificationRule: { ...REST, updatesToPost: "Other" },
    expected: "Other",
  },
];

describePostgres(
  "AddCustomFieldsAndRemindersToUpdatesToPost1809182480026 against Postgres",
  () => {
    const schema: string = `updates_to_post_${id().replace(/-/g, "")}`;
    let database: DataSource;
    let runner: QueryRunner;
    const ids: Map<string, string> = new Map<string, string>();

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["UPDATES_TO_POST_MIGRATION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["UPDATES_TO_POST_MIGRATION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["UPDATES_TO_POST_MIGRATION_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      // The columns the migration reads, as the model makes them.
      await database.query(
        `CREATE TABLE "${schema}"."WorkspaceNotificationRule" ("_id" uuid PRIMARY KEY, "eventType" character varying(100) NOT NULL, "notificationRule" jsonb NOT NULL)`,
      );

      for (const seed of SEEDS) {
        const ruleId: string = id();
        ids.set(seed.label, ruleId);

        await database.query(
          `INSERT INTO "${schema}"."WorkspaceNotificationRule" ("_id", "eventType", "notificationRule") VALUES ($1, $2, $3::jsonb)`,
          [ruleId, seed.eventType, JSON.stringify(seed.notificationRule)],
        );
      }

      runner = database.createQueryRunner();
    });

    afterAll(async () => {
      await runner?.release();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function ruleOf(label: string): Promise<JSONObject> {
      const rows: Array<{ notificationRule: JSONObject }> =
        await database.query(
          `SELECT "notificationRule" FROM "${schema}"."WorkspaceNotificationRule" WHERE "_id" = $1`,
          [ids.get(label)],
        );

      return rows[0]!.notificationRule;
    }

    test("each rule gets the new box where it ticked the old one, and keeps the rest of its JSON", async () => {
      await new AddCustomFieldsAndRemindersToUpdatesToPost1809182480026().up(
        runner,
      );

      for (const seed of SEEDS) {
        const rule: JSONObject = await ruleOf(seed.label);

        expect({
          seed: seed.label,
          updatesToPost: rule["updatesToPost"],
        }).toEqual({ seed: seed.label, updatesToPost: seed.expected });

        // Everything but the list, as it was.
        const rest: JSONObject = { ...rule };
        delete rest["updatesToPost"];
        const restBefore: JSONObject = { ...seed.notificationRule };
        delete restBefore["updatesToPost"];

        expect(rest).toEqual(restBefore);
      }
    });

    test("what it wrote reads as the choice the rule made: the same updates, the new box with the old", async () => {
      const incident: JSONObject = await ruleOf(
        "an incident rule with Other edits and Everything else",
      );

      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: incident,
          updateKinds: ["Reminders"] as never,
        }),
      ).toBe(true);
      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: incident,
          updateKinds: ["CustomFields"] as never,
        }),
      ).toBe(true);

      const key: JSONObject = await ruleOf(
        "an incident rule of Key updates only: neither box",
      );

      expect(
        NotificationRuleUpdates.wantsUpdate({
          rule: key,
          updateKinds: ["Reminders"] as never,
        }),
      ).toBe(false);
    });

    test("run again, it changes nothing", async () => {
      const before: Array<JSONObject> = await database.query(
        `SELECT "_id", "notificationRule" FROM "${schema}"."WorkspaceNotificationRule" ORDER BY "_id"`,
      );

      await new AddCustomFieldsAndRemindersToUpdatesToPost1809182480026().up(
        runner,
      );

      const after: Array<JSONObject> = await database.query(
        `SELECT "_id", "notificationRule" FROM "${schema}"."WorkspaceNotificationRule" ORDER BY "_id"`,
      );

      expect(after).toEqual(before);
    });

    test("its down takes both boxes out of every list", async () => {
      await new AddCustomFieldsAndRemindersToUpdatesToPost1809182480026().down(
        runner,
      );

      expect(
        (await ruleOf("an incident rule with Other edits and Everything else"))[
          "updatesToPost"
        ],
      ).toEqual(["PrivateNotes", "Edits", "Other"]);
      expect(
        (await ruleOf("an incident rule that ticked the new box already"))[
          "updatesToPost"
        ],
      ).toEqual(["Other"]);
      expect(
        (await ruleOf("an incident rule that posts every update: no list"))[
          "updatesToPost"
        ],
      ).toBeUndefined();
      expect(
        (await ruleOf("a list typed by hand that is not a list"))[
          "updatesToPost"
        ],
      ).toBe("Other");
    });
  },
);
