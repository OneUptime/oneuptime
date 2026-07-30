import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
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

export interface LoadedTraceDropFilter {
  filter: TraceDropFilter;
  /*
   * Pre-compiled at cache load time so the per-span evaluation
   * loop never re-tokenizes / re-parses the filterQuery string.
   * See LogFilterEvaluator.compileFilter.
   */
  compiledFilter: CompiledFilter;
  /*
   * The project the filter was loaded for. Carried here so the drop
   * recorder can attribute drops without depending on the shape of the
   * span row being evaluated.
   */
  projectId: ObjectID;
}

interface CacheEntry {
  filters: Array<LoadedTraceDropFilter>;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const dropFilterCache: Map<string, CacheEntry> = new Map();

export class TraceDropFilterService {
  public static async loadDropFilters(
    projectId: ObjectID,
  ): Promise<Array<LoadedTraceDropFilter>> {
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

    const loaded: Array<LoadedTraceDropFilter> = filters.map(
      (filter: TraceDropFilter) => {
        return {
          filter,
          /*
           * `emptyQueryMatches: false` is load-bearing. A drop filter with a
           * blank query used to compile to "match every record", which
           * turned it into "discard 100% of this project's spans" —
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

  public static shouldDropSpan(
    spanRow: JSONObject,
    filters: Array<LoadedTraceDropFilter>,
  ): boolean {
    for (const { filter, compiledFilter, projectId } of filters) {
      if (!evaluateCompiledFilter(spanRow, compiledFilter)) {
        continue;
      }

      if (filter.action === TraceDropFilterAction.Drop) {
        this.recordDrop(filter, projectId, TraceDropFilterAction.Drop);
        return true;
      }

      if (filter.action === TraceDropFilterAction.Sample) {
        /*
         * An unset or out-of-range percentage resolves to "keep
         * everything" rather than the old hardcoded 50. See
         * DropFilterSampling for why 0 is treated as misconfigured.
         */
        if (shouldDropBySampling(filter.samplePercentage)) {
          this.recordDrop(filter, projectId, TraceDropFilterAction.Sample);
          return true;
        }
      }
    }

    return false;
  }

  /*
   * Every drop goes through here so no drop can ever again be invisible.
   * Recording must never be able to fail an ingest batch — a dropped span is
   * still a successful outcome for the request.
   */
  private static recordDrop(
    filter: TraceDropFilter,
    projectId: ObjectID,
    action: TraceDropFilterAction,
  ): void {
    if (!filter.id) {
      return;
    }

    try {
      recordDroppedRecord({
        projectId: projectId,
        filterId: filter.id,
        signal: DropFilterSignal.Traces,
        action: action,
      });
    } catch {
      // Observability must not break ingest.
    }
  }
}

export default TraceDropFilterService;
