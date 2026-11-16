import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * THE RULES THAT CHOSE THEIR UPDATES KEEP POSTING WHAT THEY DID (issues
 * #7937, #7938).
 *
 * A notification rule's Updates step stores the updates the rule posts as a
 * list in its JSON (notificationRule.updatesToPost). An incident's or an
 * alert's custom field edits were posted as one of its Other edits (Edits),
 * and the reminders that an incident, an alert or a maintenance event is
 * still open as Everything else (Other): a rule that ticked those boxes got
 * them. Each is a box of its own now (NotificationRuleUpdates), so every
 * rule saved with the old box ticked gets the new one ticked too:
 *
 *   - an incident or alert rule that lists Edits lists CustomFields;
 *   - an incident, alert or scheduled maintenance rule that lists Other
 *     lists Reminders.
 *
 * Added at the end of the list, which is read as a set. A rule with no list
 * posts every update, the new ones included, and is left as it is; so is
 * one that does not list the old box, or lists the new one already. Run
 * again, it changes nothing.
 *
 * A schema migration, though it changes data and not the schema (the
 * generator writes nothing for it, and the drift check is unaffected): the
 * servers of this release wait for it before they start, and from then on
 * a custom field edit and a reminder are posted as updates of their own. A
 * rule not rewritten yet would miss them. The table holds a project's rules,
 * a few rows each.
 */

// The rules' kinds of record, as WorkspaceNotificationRule.eventType stores them.
export const CUSTOM_FIELDS_EVENT_TYPES: Array<string> = ["Incident", "Alert"];
export const REMINDERS_EVENT_TYPES: Array<string> = [
  "Incident",
  "Alert",
  "Scheduled Maintenance",
];

/*
 * Adds the update $1 to the lists that hold $2, of the rules of the kinds in
 * $3: a list that is a JSON array, holds $2 and not $1 yet.
 */
export const ADD_UPDATE_KIND_SQL: string = `UPDATE "WorkspaceNotificationRule" SET "notificationRule" = jsonb_set("notificationRule", '{updatesToPost}', ("notificationRule" -> 'updatesToPost') || to_jsonb($1::text)) WHERE "eventType" = ANY($3::varchar[]) AND jsonb_typeof("notificationRule" -> 'updatesToPost') = 'array' AND ("notificationRule" -> 'updatesToPost') ? $2::text AND NOT (("notificationRule" -> 'updatesToPost') ? $1::text)`;

// Takes the update $1 out of every list that holds it.
export const REMOVE_UPDATE_KIND_SQL: string = `UPDATE "WorkspaceNotificationRule" SET "notificationRule" = jsonb_set("notificationRule", '{updatesToPost}', ("notificationRule" -> 'updatesToPost') - $1::text) WHERE jsonb_typeof("notificationRule" -> 'updatesToPost') = 'array' AND ("notificationRule" -> 'updatesToPost') ? $1::text`;

export class AddCustomFieldsAndRemindersToUpdatesToPost1809182480026
  implements MigrationInterface
{
  public name: string =
    "AddCustomFieldsAndRemindersToUpdatesToPost1809182480026";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(ADD_UPDATE_KIND_SQL, [
      "CustomFields",
      "Edits",
      CUSTOM_FIELDS_EVENT_TYPES,
    ]);

    await queryRunner.query(ADD_UPDATE_KIND_SQL, [
      "Reminders",
      "Other",
      REMINDERS_EVENT_TYPES,
    ]);
  }

  /*
   * The release before knows neither update, and its API refuses a list
   * that holds one: both come out of every list, and the old boxes they
   * came out of post them again there.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(REMOVE_UPDATE_KIND_SQL, ["Reminders"]);
    await queryRunner.query(REMOVE_UPDATE_KIND_SQL, ["CustomFields"]);
  }
}
