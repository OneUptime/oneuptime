import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a Slack or Microsoft Teams notification rule that creates a
 * channel for each record keeps naming its channels as it did, now that its
 * prefix is optional.
 *
 * The prefix of a rule's channels (notificationRule.newChannelTemplateName,
 * "Channel Name Prefix" in the rule form) used to be required by the form,
 * and a rule saved without one - through the API or Terraform, or a monitor
 * or on-call policy rule, whose form never asked for one - was given
 * "oneuptime-" + its event type + "-" by the server: incident INC-42's
 * channel was oneuptime-incident-inc-42. An empty prefix now means none: the
 * channel is the record's own name, inc-42 (Utils/Workspace/
 * WorkspaceChannelName). This writes that old default into every rule that
 * creates channels without a prefix, so its next channels get the names
 * its last ones had.
 *
 * Which rules: the server read the rule as JavaScript does -
 * `newChannelTemplateName || default`, `if (shouldCreateNewChannel)` - so
 * the same values are matched here. A prefix is missing when the key is
 * absent or holds null, "", false or 0; a prefix of spaces counted as one
 * (in Slack it named the channel inc-42 then too) and is left alone. A rule
 * creates channels when shouldCreateNewChannel is true, a non-empty string,
 * a number other than 0, an object or an array. Only JSON objects are
 * touched: jsonb_set raises on a scalar.
 *
 * The default is written out rather than imported so the migration keeps
 * doing what it did when it shipped; it matches
 * WorkspaceChannelName.getLegacyDefaultPrefix, which a test pins it to. The
 * event types are ASCII, so lower() lowercases them as toLowerCase() did
 * ("Scheduled Maintenance" -> "oneuptime-scheduled maintenance-", whose
 * space Slack leaves out of the name).
 *
 * A data change, run with the schema migrations so it is in place before
 * any server reads a rule under the new meaning. down() restores nothing:
 * with the old code, a rule holding the old default names its channels
 * exactly as it did without it.
 */
export const KEEP_CHANNEL_NAME_PREFIX_UPDATE: string = `UPDATE "WorkspaceNotificationRule" SET "notificationRule" = jsonb_set("notificationRule", '{newChannelTemplateName}', to_jsonb('oneuptime-' || lower("eventType") || '-')) WHERE jsonb_typeof("notificationRule") = 'object' AND (CASE jsonb_typeof("notificationRule"->'shouldCreateNewChannel') WHEN 'boolean' THEN ("notificationRule"->>'shouldCreateNewChannel')::boolean WHEN 'string' THEN "notificationRule"->>'shouldCreateNewChannel' <> '' WHEN 'number' THEN ("notificationRule"->>'shouldCreateNewChannel')::numeric <> 0 WHEN 'object' THEN true WHEN 'array' THEN true ELSE false END) AND (NOT ("notificationRule" ? 'newChannelTemplateName') OR "notificationRule"->'newChannelTemplateName' IN ('null'::jsonb, '""'::jsonb, 'false'::jsonb, '0'::jsonb))`;

export class KeepChannelNamePrefixOfRulesWithoutOne1802200000000
  implements MigrationInterface
{
  public name: string = "KeepChannelNamePrefixOfRulesWithoutOne1802200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(KEEP_CHANNEL_NAME_PREFIX_UPDATE);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
