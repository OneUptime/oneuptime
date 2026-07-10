import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * Sum of totalTokens this project has consumed for the given features since
   * the given time — one SQL aggregate, used on the hot path of the daily
   * autonomous-budget check (G4).
   */
  @CaptureSpan()
  public async getTotalTokensUsedSince(data: {
    projectId: ObjectID;
    since: Date;
    features: Array<string>;
  }): Promise<number> {
    if (data.features.length === 0) {
      return 0;
    }

    const rows: Array<{ total: string | number | null }> =
      await this.getRepository().manager.query(
        `SELECT COALESCE(SUM("totalTokens"), 0) AS "total" FROM "LlmLog" WHERE "projectId" = $1 AND "createdAt" >= $2 AND "feature" = ANY($3) AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.since, data.features],
      );

    return Number(rows[0]?.total || 0);
  }
}

export default new Service();
