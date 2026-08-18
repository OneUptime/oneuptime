import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Log from "../../Models/AnalyticsModels/Log";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../Types/AnalyticsDatabase/Hooks";
import ResourceEntityFilter from "../Utils/Telemetry/ResourceEntityFilter";

export class LogService extends AnalyticsDatabaseService<Log> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Log, database: clickhouseDatabase });
  }

  /*
   * Resolve the logs explorer's resource-facet selections (a Kubernetes
   * cluster, a host, ...) before the query is compiled. They arrive as
   * Postgres ids under `resourceFilters`; matching them needs the
   * resource's entity key, which only Postgres can supply. See
   * ResourceEntityFilter.
   */
  protected override async onBeforeFind(
    findBy: FindBy<Log>,
  ): Promise<OnFind<Log>> {
    await ResourceEntityFilter.rewriteAnalyticsQuery({
      query: findBy.query as unknown as Record<string, unknown>,
      projectId: findBy.props?.tenantId,
    });

    return { findBy, carryForward: null };
  }
}

export default new LogService();
