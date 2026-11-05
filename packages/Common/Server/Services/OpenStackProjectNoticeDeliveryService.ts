import Model from "../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
} from "../../Types/OpenStack/OpenStackProjectNotice";
import ProjectReferencesService from "./ProjectReferencesService";

export interface OpenStackProjectNoticeDeliveryToRecord {
  projectId: ObjectID;
  openStackCloudId: ObjectID;
  openStackProjectNoticeId: string;
  openStackProjectId: string;
  event: OpenStackProjectNoticeEvent;
  dedupeKey: string;
  partKey: string;
  incidentId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  facts: JSONObject;
}

/*
 * What a notice told someone, or was going to. The two statements here are by hand because what they
 * guarantee is only theirs to guarantee: only one row can exist for a notice and what it told of, and
 * only one worker can take a row to send it. OpenStackProjectNoticePostgres holds them to that.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // Each at most once however many times this is called. Returns how many are new.
  public async recordIfNew(
    rows: ReadonlyArray<OpenStackProjectNoticeDeliveryToRecord>,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const inserted: Array<unknown> = await this.getRepository().manager.query(
      `INSERT INTO "OpenStackProjectNoticeDelivery" (
         "projectId", "openStackCloudId", "openStackProjectNoticeId", "openStackProjectId", "event",
         "dedupeKey", "partKey", "incidentId", "scheduledMaintenanceId", "facts", "status", "attempts"
       )
       SELECT row."projectId"::uuid, row."openStackCloudId"::uuid, row."openStackProjectNoticeId"::uuid,
              row."openStackProjectId", row."event", row."dedupeKey", row."partKey",
              row."incidentId"::uuid, row."scheduledMaintenanceId"::uuid, row."facts",
              '${OpenStackProjectNoticeDeliveryStatus.Pending}', 0
       FROM jsonb_to_recordset($1::jsonb) AS row(
         "projectId" text, "openStackCloudId" text, "openStackProjectNoticeId" text,
         "openStackProjectId" text, "event" text, "dedupeKey" text, "partKey" text,
         "incidentId" text, "scheduledMaintenanceId" text, "facts" jsonb
       )
       ON CONFLICT ("openStackProjectNoticeId", "dedupeKey") DO NOTHING
       RETURNING "_id"`,
      [
        JSON.stringify(
          rows.map((row: OpenStackProjectNoticeDeliveryToRecord) => {
            return {
              ...row,
              projectId: row.projectId.toString(),
              openStackCloudId: row.openStackCloudId.toString(),
              incidentId: row.incidentId?.toString() || null,
              scheduledMaintenanceId:
                row.scheduledMaintenanceId?.toString() || null,
            };
          }),
        ),
      ],
    );

    return inserted.length;
  }

  // Taken by one worker alone. False when another has it or it is no longer waiting.
  public async claimForSending(id: ObjectID): Promise<boolean> {
    const claimed: Array<unknown> = await this.getRepository().manager.query(
      `UPDATE "OpenStackProjectNoticeDelivery"
       SET "status" = '${OpenStackProjectNoticeDeliveryStatus.Sending}',
           "attempts" = "attempts" + 1,
           "updatedAt" = now()
       WHERE "_id" = $1 AND "status" = '${OpenStackProjectNoticeDeliveryStatus.Pending}'
       RETURNING "_id"`,
      [id.toString()],
    );

    // Through this driver an UPDATE ... RETURNING answers [rows, count].
    const rows: unknown = Array.isArray(claimed[0]) ? claimed[0] : claimed;

    return (rows as Array<unknown>).length === 1;
  }
}

export default new Service();
