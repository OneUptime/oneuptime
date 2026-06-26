import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import {
  compileFilter,
  CompiledFilter,
  evaluateCompiledFilter,
} from "../Utils/LogFilterEvaluator";

export interface LoadedLogDropFilter {
  filter: LogDropFilter;
  /*
   * Pre-compiled at cache load time so the per-log evaluation
   * loop never re-tokenizes / re-parses the filterQuery string.
   * See LogFilterEvaluator.compileFilter.
   */
  compiledFilter: CompiledFilter;
}

interface CacheEntry {
  filters: Array<LoadedLogDropFilter>;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const dropFilterCache: Map<string, CacheEntry> = new Map();

export class LogDropFilterService {
  public static async loadDropFilters(
    projectId: ObjectID,
  ): Promise<Array<LoadedLogDropFilter>> {
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

    const loaded: Array<LoadedLogDropFilter> = filters.map(
      (filter: LogDropFilter) => {
        return {
          filter,
          compiledFilter: compileFilter((filter.filterQuery as string) || ""),
        };
      },
    );

    dropFilterCache.set(cacheKey, { filters: loaded, loadedAt: Date.now() });
    return loaded;
  }

  public static shouldDropLog(
    logRow: JSONObject,
    filters: Array<LoadedLogDropFilter>,
  ): boolean {
    for (const { filter, compiledFilter } of filters) {
      if (!evaluateCompiledFilter(logRow, compiledFilter)) {
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
