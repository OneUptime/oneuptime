import DatabaseService, { EntityManager } from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import UserNotificationSetting from "../../Models/DatabaseModels/UserNotificationSetting";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../Types/NotificationSetting/RoutineEmailEvents";
import ObjectID from "../../Types/ObjectID";

export class Service extends DatabaseService<UserNotificationSetting> {
  public constructor() {
    super(UserNotificationSetting);
  }

  /*
   * The API authorizes the authenticated user's own settings before calling
   * this method. Every statement remains scoped to that user and project.
   */
  @CaptureSpan()
  public async reduceRoutineEmails(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    await this.executeTransaction(async (manager: EntityManager) => {
      /*
       * There is no unique constraint on (user, project, event). Serializing
       * preset requests also protects the missing-row insert on a double click.
       */
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `routine-email-settings:${data.projectId.toString()}:${data.userId.toString()}`,
        ],
      );

      const parameters: [string, string, ReadonlyArray<string>] = [
        data.userId.toString(),
        data.projectId.toString(),
        ROUTINE_EMAIL_EVENT_TYPES,
      ];

      /*
       * Update every matching row, including historical duplicates. Changing
       * only email avoids overwriting another channel edited concurrently.
       */
      await manager.query(
        `UPDATE "UserNotificationSetting"
         SET "alertByEmail" = false, "updatedAt" = now(), "version" = "version" + 1
         WHERE "userId" = $1 AND "projectId" = $2
           AND "eventType" = ANY($3::text[])
           AND "deletedAt" IS NULL AND "alertByEmail" = true`,
        parameters,
      );

      /*
       * Persist an explicit opt-out for missing events so later default
       * seeding sees the user's choice. Other channels keep their false defaults.
       */
      await manager.query(
        `INSERT INTO "UserNotificationSetting"
           ("userId", "projectId", "eventType", "alertByEmail", "createdByUserId", "version")
         SELECT $1::uuid, $2::uuid, event."eventType", false, $1::uuid, 1
         FROM unnest($3::text[]) AS event("eventType")
         WHERE NOT EXISTS (
           SELECT 1 FROM "UserNotificationSetting" setting
           WHERE setting."userId" = $1 AND setting."projectId" = $2
             AND setting."eventType" = event."eventType"
             AND setting."deletedAt" IS NULL
         )`,
        parameters,
      );
    });
  }
}

export default new Service();
