import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TracePipelineProcessorType, {
  AttributeRemapperConfig,
  SpanNameRemapperConfig,
  StatusRemapperConfig,
  SpanKindRemapperConfig,
  CategoryProcessorConfig,
} from "Common/Types/Trace/TracePipelineProcessorType";
import {
  compileFilter,
  CompiledFilter,
  evaluateCompiledFilter,
} from "../Utils/LogFilterEvaluator";
import logger from "Common/Server/Utils/Logger";

export interface LoadedTracePipeline {
  pipeline: TracePipeline;
  /*
   * Pre-compiled at cache load time so per-span evaluation
   * doesn't re-tokenize / re-parse the filterQuery on every
   * record. See LogFilterEvaluator.compileFilter.
   */
  compiledFilter: CompiledFilter;
  processors: Array<TracePipelineProcessor>;
}

interface CacheEntry {
  pipelines: Array<LoadedTracePipeline>;
  loadedAt: number;
}

interface CompiledCategoryConfig extends CategoryProcessorConfig {
  _compiledCategoryFilters?: Array<CompiledFilter>;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const pipelineCache: Map<string, CacheEntry> = new Map();

export class TracePipelineService {
  public static async loadPipelines(
    projectId: ObjectID,
  ): Promise<Array<LoadedTracePipeline>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = pipelineCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.pipelines;
    }

    const pipelineService: DatabaseService<TracePipeline> =
      new DatabaseService<TracePipeline>(TracePipeline);

    const pipelines: Array<TracePipeline> = await pipelineService.findBy({
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
        sortOrder: true,
      },
      props: {
        isRoot: true,
      },
    });

    const processorService: DatabaseService<TracePipelineProcessor> =
      new DatabaseService<TracePipelineProcessor>(TracePipelineProcessor);

    const loaded: Array<LoadedTracePipeline> = [];

    for (const pipeline of pipelines) {
      const processors: Array<TracePipelineProcessor> =
        await processorService.findBy({
          query: {
            tracePipelineId: pipeline._id,
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
            processorType: true,
            configuration: true,
            sortOrder: true,
          },
          props: {
            isRoot: true,
          },
        });

      loaded.push({
        pipeline,
        compiledFilter: compileFilter((pipeline.filterQuery as string) || ""),
        processors,
      });
    }

    pipelineCache.set(cacheKey, { pipelines: loaded, loadedAt: Date.now() });
    return loaded;
  }

  public static processSpan(
    spanRow: JSONObject,
    pipelines: Array<LoadedTracePipeline>,
  ): JSONObject {
    let result: JSONObject = { ...spanRow };

    for (const { pipeline, compiledFilter, processors } of pipelines) {
      if (!evaluateCompiledFilter(result, compiledFilter)) {
        continue;
      }

      for (const processor of processors) {
        try {
          result = TracePipelineService.applyProcessor(result, processor);
        } catch (err) {
          logger.error(
            `Error applying processor "${processor.name}" in trace pipeline "${pipeline.name}": ${err}`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Processor configuration is stored in a jsonb column but the UI's JSON
   * form field persists it as a JSON string literal, so TypeORM hands us
   * back a string that still needs parsing. Accept either shape.
   */
  private static normalizeProcessorConfig(raw: unknown): JSONObject {
    if (raw && typeof raw === "object") {
      return raw as JSONObject;
    }
    if (typeof raw === "string") {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return parsed as JSONObject;
        }
      } catch {
        // fall through
      }
    }
    return {};
  }

  private static applyProcessor(
    spanRow: JSONObject,
    processor: TracePipelineProcessor,
  ): JSONObject {
    const config: JSONObject = TracePipelineService.normalizeProcessorConfig(
      processor.configuration,
    );

    switch (processor.processorType) {
      case TracePipelineProcessorType.AttributeRemapper:
        return TracePipelineService.applyAttributeRemapper(
          spanRow,
          config as unknown as AttributeRemapperConfig,
        );
      case TracePipelineProcessorType.SpanNameRemapper:
        return TracePipelineService.applySpanNameRemapper(
          spanRow,
          config as unknown as SpanNameRemapperConfig,
        );
      case TracePipelineProcessorType.StatusRemapper:
        return TracePipelineService.applyStatusRemapper(
          spanRow,
          config as unknown as StatusRemapperConfig,
        );
      case TracePipelineProcessorType.SpanKindRemapper:
        return TracePipelineService.applySpanKindRemapper(
          spanRow,
          config as unknown as SpanKindRemapperConfig,
        );
      case TracePipelineProcessorType.CategoryProcessor:
        return TracePipelineService.applyCategoryProcessor(
          spanRow,
          config as unknown as CompiledCategoryConfig,
        );
      default:
        return spanRow;
    }
  }

  private static applyAttributeRemapper(
    spanRow: JSONObject,
    config: AttributeRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> = {
      ...((spanRow["attributes"] as Record<string, unknown>) || {}),
    };

    const sourceVal: unknown = attrs[config.sourceKey];
    if (sourceVal === undefined) {
      return spanRow;
    }

    const overrideOnConflict: boolean = config.overrideOnConflict !== false;
    if (!overrideOnConflict && attrs[config.targetKey] !== undefined) {
      return spanRow;
    }

    attrs[config.targetKey] = sourceVal;

    if (!config.preserveSource) {
      delete attrs[config.sourceKey];
    }

    const attributeKeys: Array<string> = Object.keys(attrs);

    return { ...spanRow, attributes: attrs as JSONObject, attributeKeys };
  }

  private static applySpanNameRemapper(
    spanRow: JSONObject,
    config: SpanNameRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> =
      (spanRow["attributes"] as Record<string, unknown>) || {};
    // sourceKey can either be "name" (the span name itself) or an attribute key.
    let sourceVal: unknown;
    if (config.sourceKey === "name") {
      sourceVal = spanRow["name"];
    } else {
      sourceVal = attrs[config.sourceKey];
    }
    if (sourceVal === undefined || sourceVal === null) {
      return spanRow;
    }

    const sourceStr: string = String(sourceVal);

    for (const mapping of config.mappings || []) {
      if (mapping.matchValue === sourceStr) {
        return { ...spanRow, name: mapping.newName };
      }
    }

    return spanRow;
  }

  private static applyStatusRemapper(
    spanRow: JSONObject,
    config: StatusRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> =
      (spanRow["attributes"] as Record<string, unknown>) || {};
    const sourceVal: unknown = attrs[config.sourceKey];
    if (sourceVal === undefined || sourceVal === null) {
      return spanRow;
    }

    const sourceStr: string = String(sourceVal);

    for (const mapping of config.mappings || []) {
      if (mapping.matchValue === sourceStr) {
        return {
          ...spanRow,
          statusCode: mapping.statusCode,
          statusMessage:
            mapping.statusMessage ?? (spanRow["statusMessage"] as string) ?? "",
        };
      }
    }

    return spanRow;
  }

  private static applySpanKindRemapper(
    spanRow: JSONObject,
    config: SpanKindRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> =
      (spanRow["attributes"] as Record<string, unknown>) || {};
    let sourceVal: unknown;
    if (config.sourceKey === "kind") {
      sourceVal = spanRow["kind"];
    } else {
      sourceVal = attrs[config.sourceKey];
    }
    if (sourceVal === undefined || sourceVal === null) {
      return spanRow;
    }

    const sourceStr: string = String(sourceVal);

    for (const mapping of config.mappings || []) {
      if (mapping.matchValue === sourceStr) {
        return { ...spanRow, kind: mapping.kind };
      }
    }

    return spanRow;
  }

  private static applyCategoryProcessor(
    spanRow: JSONObject,
    config: CompiledCategoryConfig,
  ): JSONObject {
    const categories: CategoryProcessorConfig["categories"] =
      config.categories || [];
    if (categories.length === 0) {
      return spanRow;
    }

    /*
     * Lazy-compile category filters on first hit. The pipeline
     * cache holds this object for the 60s TTL window so we pay
     * the compile cost at most once per category per window.
     */
    if (
      !config._compiledCategoryFilters ||
      config._compiledCategoryFilters.length !== categories.length
    ) {
      config._compiledCategoryFilters = categories.map(
        (category: CategoryProcessorConfig["categories"][number]) => {
          return compileFilter(category.filterQuery || "");
        },
      );
    }

    for (let i: number = 0; i < categories.length; i++) {
      const category: CategoryProcessorConfig["categories"][number] =
        categories[i]!;
      const compiled: CompiledFilter | undefined =
        config._compiledCategoryFilters[i];
      if (!compiled) {
        continue;
      }
      if (evaluateCompiledFilter(spanRow, compiled)) {
        const attrs: Record<string, unknown> = {
          ...((spanRow["attributes"] as Record<string, unknown>) || {}),
        };
        attrs[config.targetKey] = category.name;
        const attributeKeys: Array<string> = Object.keys(attrs);
        return { ...spanRow, attributes: attrs as JSONObject, attributeKeys };
      }
    }

    return spanRow;
  }
}

export default TracePipelineService;
