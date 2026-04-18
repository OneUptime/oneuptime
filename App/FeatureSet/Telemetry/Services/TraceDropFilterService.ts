import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import { evaluateFilter } from "../Utils/LogFilterEvaluator";

interface CacheEntry {
  filters: Array<TraceDropFilter>;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const dropFilterCache: Map<string, CacheEntry> = new Map();

export class TraceDropFilterService {
  public static async loadDropFilters(
    projectId: ObjectID,
  ): Promise<Array<TraceDropFilter>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = dropFilterCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.filters;
    }

    const service: DatabaseService<TraceDropFilter> =
      new DatabaseService<TraceDropFilter>(TraceDropFilter);

    const filters: Array<TraceDropFilter> = await service.findBy({
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

  public static shouldDropSpan(
    spanRow: JSONObject,
    filters: Array<TraceDropFilter>,
  ): boolean {
    for (const filter of filters) {
      const filterQuery: string = (filter.filterQuery as string) || "";

      if (!evaluateFilter(spanRow, filterQuery)) {
        continue;
      }

      if (filter.action === TraceDropFilterAction.Drop) {
        return true;
      }

      if (filter.action === TraceDropFilterAction.Sample) {
        const samplePercentage: number = filter.samplePercentage || 50;
        // Keep samplePercentage% of spans, drop the rest.
        if (Math.random() * 100 >= samplePercentage) {
          return true;
        }
      }
    }

    return false;
  }
}

export default TraceDropFilterService;
