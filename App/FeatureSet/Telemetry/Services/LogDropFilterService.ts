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
import { shouldDropBySampling } from "Common/Types/Telemetry/DropFilterSampling";
import {
  DropFilterSignal,
  recordDroppedRecord,
} from "../Utils/DropFilterDropRecorder";

export interface LoadedLogDropFilter {
  filter: LogDropFilter;
  /*
   * Pre-compiled at cache load time so the per-log evaluation
   * loop never re-tokenizes / re-parses the filterQuery string.
   * See LogFilterEvaluator.compileFilter.
   */
  compiledFilter: CompiledFilter;
  /*
   * The project the filter was loaded for. Carried here so the drop
   * recorder can attribute drops without depending on the shape of the
   * log row being evaluated.
   */
  projectId: ObjectID;
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
          /*
           * `emptyQueryMatches: false` is load-bearing. A drop filter with a
           * blank query used to compile to "match every record", which
           * turned it into "discard 100% of this project's logs" —
           * silently, and with no counter to notice it by. Save-time
           * validation now rejects a blank query, but rows created before
           * that must not keep shredding data, so the engine treats an
           * empty query as matching nothing.
           */
          compiledFilter: compileFilter((filter.filterQuery as string) || "", {
            emptyQueryMatches: false,
          }),
          projectId: projectId,
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
    for (const { filter, compiledFilter, projectId } of filters) {
      if (!evaluateCompiledFilter(logRow, compiledFilter)) {
        continue;
      }

      // Filter matches this log
      if (filter.action === LogDropFilterAction.Drop) {
        this.recordDrop(filter, projectId, LogDropFilterAction.Drop);
        return true;
      }

      if (filter.action === LogDropFilterAction.Sample) {
        /*
         * An unset or out-of-range percentage resolves to "keep
         * everything" rather than the old hardcoded 50. See
         * DropFilterSampling for why 0 is treated as misconfigured.
         */
        if (shouldDropBySampling(filter.samplePercentage)) {
          this.recordDrop(filter, projectId, LogDropFilterAction.Sample);
          return true; // drop this log
        }
      }
    }

    return false;
  }

  /*
   * Every drop goes through here so no drop can ever again be invisible.
   * Recording must never be able to fail an ingest batch — a dropped log is
   * still a successful outcome for the request.
   */
  private static recordDrop(
    filter: LogDropFilter,
    projectId: ObjectID,
    action: LogDropFilterAction,
  ): void {
    if (!filter.id) {
      return;
    }

    try {
      recordDroppedRecord({
        projectId: projectId,
        filterId: filter.id,
        signal: DropFilterSignal.Logs,
        action: action,
      });
    } catch {
      // Observability must not break ingest.
    }
  }
}

export default LogDropFilterService;
