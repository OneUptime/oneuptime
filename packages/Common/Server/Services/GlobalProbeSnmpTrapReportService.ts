import Model from "../../Models/DatabaseModels/GlobalProbeSnmpTrapReport";
import ObjectID from "../../Types/ObjectID";
import { SnmpTrapRefusal } from "../../Types/Probe/SnmpTrapReceiver";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Each project's share of a global probe's SNMP trap receiver report
 * (GlobalProbeSnmpTrapReport, OneUptime issue #11173). Written only by
 * OneUptime, as the probe reports every thirty seconds; people read it on
 * their devices' pages.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A global probe's report, as its projects' shares
   * (SnmpTrapRefusalShares.split): in one statement, each project's row
   * written only when its share changed - a probe reports every thirty
   * seconds and its refusals change far less often - and the rows of every
   * other project deleted, so a project whose devices stopped being refused,
   * or that no longer uses the probe, is told nothing stale. A share is the
   * whole of what the project may read of this probe's refusals: it
   * replaces the row, never merges into it.
   */
  @CaptureSpan()
  public async recordShares(data: {
    probeId: ObjectID;
    sharesByProject: Map<string, Array<SnmpTrapRefusal>>;
  }): Promise<void> {
    const shares: Array<{
      projectId: string;
      refusals: Array<SnmpTrapRefusal>;
    }> = [];

    for (const [projectId, share] of data.sharesByProject) {
      if (!ObjectID.isValidUUID(projectId) || share.length === 0) {
        continue;
      }

      shares.push({ projectId: projectId.toLowerCase(), refusals: share });
    }

    await this.getRepository().manager.query(
      `
        WITH incoming AS (
          SELECT (entry->>'projectId')::uuid AS "projectId",
            entry->'refusals' AS "refusals"
          FROM jsonb_array_elements($2::jsonb) AS entry
        ),
        removed AS (
          DELETE FROM "GlobalProbeSnmpTrapReport"
          WHERE "probeId" = $1::uuid
            AND "projectId" NOT IN (SELECT "projectId" FROM incoming)
          RETURNING "_id"
        ),
        written AS (
          INSERT INTO "GlobalProbeSnmpTrapReport"
            ("projectId", "probeId", "refusals", "version")
          SELECT incoming."projectId", $1::uuid, incoming."refusals", 0
          FROM incoming
          ON CONFLICT ("projectId", "probeId") DO UPDATE
          SET "refusals" = EXCLUDED."refusals",
            "updatedAt" = now(),
            "version" = "GlobalProbeSnmpTrapReport"."version" + 1
          WHERE "GlobalProbeSnmpTrapReport"."refusals" IS DISTINCT FROM EXCLUDED."refusals"
          RETURNING "_id"
        )
        SELECT (SELECT count(*) FROM removed)::int AS "removed",
          (SELECT count(*) FROM written)::int AS "written"
      `,
      [data.probeId.toString(), JSON.stringify(shares)],
    );
  }
}

export default new Service();
