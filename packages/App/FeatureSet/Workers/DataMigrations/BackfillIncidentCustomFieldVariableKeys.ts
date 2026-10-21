import DataMigrationBase from "./DataMigrationBase";
import { backfillIncidentCustomFieldVariableKeys } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1795800000000-AddIncidentCustomFieldCreateAndNotificationSettings";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import logger from "Common/Server/Utils/Logger";

/*
 * Gives a template key (variableKey) to every incident custom field that has
 * none, as the schema migration that added the column did for the fields
 * that existed then (1795800000000-AddIncidentCustomFieldCreateAndNotificationSettings).
 *
 * Why again: with Helm's default migrate.hook: false, pods roll while the
 * migration job runs, so a pod still on the previous version can create a
 * field after that migration has committed. Its create leaves the key empty,
 * and the new version assigns keys only on create - an update never sets one
 * - so such a field could never be placed as
 * {{incident.customFields.<key>}}, is left out of webhook payloads, and
 * shows no key in the dashboard. This runs once the new Worker starts, which
 * is after the rollout has begun replacing the old pods.
 *
 * The same generator as the service's, so a field gets the key it would have
 * got had it been created on the new version; keys already taken in the
 * project are kept. Idempotent: it only fills an empty key, re-checked in the
 * UPDATE itself.
 */
export default class BackfillIncidentCustomFieldVariableKeys extends DataMigrationBase {
  public constructor() {
    super("BackfillIncidentCustomFieldVariableKeys");
  }

  public override async migrate(): Promise<void> {
    const given: number = await backfillIncidentCustomFieldVariableKeys(
      IncidentCustomFieldService.getRepository().manager,
    );

    logger.info(
      `BackfillIncidentCustomFieldVariableKeys: gave ${given} incident custom field(s) a template key.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: a filled key is what the column should hold.
    return;
  }
}
