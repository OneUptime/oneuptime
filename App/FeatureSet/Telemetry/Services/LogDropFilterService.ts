import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import { evaluateFilter } from "../Utils/LogFilterEvaluator";

interface CacheEntry {
  filters: Array<LogDropFilter>;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const dropFilterCache: Map<string, CacheEntry> = new Map();

export class LogDropFilterService {
  public static async loadDropFilters(
    projectId: ObjectID,
  ): Promise<Array<LogDropFilter>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = dropFilterCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.filters;
    }

    const service: DatabaseService<LogDropFilter> =
      new DatabaseService<LogDropFilter>(LogDropFilter);

    const filters: Array<LogDropFilter> = await service.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        sortOrder: SortOrder.Ascending,
      },
      select: {
        _id: true,
        name: true,
        filterQuery: true,
        action: true,
        samplePercentage: true,
        sortOrder: true,
      },
      props: {
        isRoot: true,
      },
    });

    dropFilterCache.set(cacheKey, { filters, loadedAt: Date.now() });
    return filters;
  }

  public static shouldDropLog(
    logRow: JSONObject,
    filters: Array<LogDropFilter>,
  ): boolean {
    for (const filter of filters) {
      const filterQuery: string = (filter.filterQuery as string) || "";

      if (!evaluateFilter(logRow, filterQuery)) {
        continue;
      }

      // Filter matches this log
      if (filter.action === LogDropFilterAction.Drop) {
        return true;
      }

      if (filter.action === LogDropFilterAction.Sample) {
        const samplePercentage: number = filter.samplePercentage || 50;
        // Keep samplePercentage% of logs, drop the rest
        if (Math.random() * 100 >= samplePercentage) {
          return true; // drop this log
        }
      }
    }

    return false;
  }
}

export default LogDropFilterService;
