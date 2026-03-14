import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType, {
  AttributeRemapperConfig,
  SeverityRemapperConfig,
  CategoryProcessorConfig,
} from "Common/Types/Log/LogPipelineProcessorType";
import { evaluateFilter } from "../Utils/LogFilterEvaluator";
import logger from "Common/Server/Utils/Logger";

export interface LoadedPipeline {
  pipeline: LogPipeline;
  processors: Array<LogPipelineProcessor>;
}

interface CacheEntry {
  pipelines: Array<LoadedPipeline>;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const pipelineCache: Map<string, CacheEntry> = new Map();

export class LogPipelineService {
  public static async loadPipelines(
    projectId: ObjectID,
  ): Promise<Array<LoadedPipeline>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = pipelineCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.pipelines;
    }

    const pipelineService: DatabaseService<LogPipeline> =
      new DatabaseService<LogPipeline>(LogPipeline);

    const pipelines: Array<LogPipeline> = await pipelineService.findBy({
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

    const processorService: DatabaseService<LogPipelineProcessor> =
      new DatabaseService<LogPipelineProcessor>(LogPipelineProcessor);

    const loaded: Array<LoadedPipeline> = [];

    for (const pipeline of pipelines) {
      const processors: Array<LogPipelineProcessor> =
        await processorService.findBy({
          query: {
            logPipelineId: pipeline._id,
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

      loaded.push({ pipeline, processors });
    }

    pipelineCache.set(cacheKey, { pipelines: loaded, loadedAt: Date.now() });
    return loaded;
  }

  public static processLog(
    logRow: JSONObject,
    pipelines: Array<LoadedPipeline>,
  ): JSONObject {
    let result: JSONObject = { ...logRow };

    for (const { pipeline, processors } of pipelines) {
      // Check if this pipeline's filter matches the log
      const filterQuery: string = (pipeline.filterQuery as string) || "";
      if (!evaluateFilter(result, filterQuery)) {
        continue;
      }

      // Apply each processor in order
      for (const processor of processors) {
        try {
          result = LogPipelineService.applyProcessor(result, processor);
        } catch (err) {
          logger.error(
            `Error applying processor "${processor.name}" in pipeline "${pipeline.name}": ${err}`,
          );
        }
      }
    }

    return result;
  }

  private static applyProcessor(
    logRow: JSONObject,
    processor: LogPipelineProcessor,
  ): JSONObject {
    const config: JSONObject = (processor.configuration as JSONObject) || {};

    switch (processor.processorType) {
      case LogPipelineProcessorType.AttributeRemapper:
        return LogPipelineService.applyAttributeRemapper(
          logRow,
          config as unknown as AttributeRemapperConfig,
        );
      case LogPipelineProcessorType.SeverityRemapper:
        return LogPipelineService.applySeverityRemapper(
          logRow,
          config as unknown as SeverityRemapperConfig,
        );
      case LogPipelineProcessorType.CategoryProcessor:
        return LogPipelineService.applyCategoryProcessor(
          logRow,
          config as unknown as CategoryProcessorConfig,
        );
      default:
        return logRow;
    }
  }

  private static resolveAttributeKey(
    attrs: Record<string, unknown>,
    key: string,
  ): string {
    // If the key already exists as-is, use it
    if (attrs[key] !== undefined) {
      return key;
    }

    // If the key doesn't have a known prefix, try with logAttributes. prefix
    const knownPrefixes: Array<string> = [
      "logAttributes.",
      "resource.",
      "scope.",
    ];
    const hasPrefix: boolean = knownPrefixes.some((prefix: string) => {
      return key.startsWith(prefix);
    });

    if (!hasPrefix) {
      const prefixedKey: string = `logAttributes.${key}`;
      if (attrs[prefixedKey] !== undefined) {
        return prefixedKey;
      }
    }

    return key;
  }

  private static resolveTargetKey(key: string): string {
    // If the target key doesn't have a known prefix, add logAttributes. prefix
    const knownPrefixes: Array<string> = [
      "logAttributes.",
      "resource.",
      "scope.",
    ];
    const hasPrefix: boolean = knownPrefixes.some((prefix: string) => {
      return key.startsWith(prefix);
    });

    if (!hasPrefix) {
      return `logAttributes.${key}`;
    }

    return key;
  }

  private static applyAttributeRemapper(
    logRow: JSONObject,
    config: AttributeRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> = {
      ...((logRow["attributes"] as Record<string, unknown>) || {}),
    };

    const resolvedSourceKey: string = LogPipelineService.resolveAttributeKey(
      attrs,
      config.sourceKey,
    );
    const sourceVal: unknown = attrs[resolvedSourceKey];
    if (sourceVal === undefined) {
      return logRow;
    }

    const resolvedTargetKey: string = LogPipelineService.resolveTargetKey(
      config.targetKey,
    );

    const overrideOnConflict: boolean = config.overrideOnConflict !== false;
    if (!overrideOnConflict && attrs[resolvedTargetKey] !== undefined) {
      return logRow;
    }

    attrs[resolvedTargetKey] = sourceVal;

    if (!config.preserveSource) {
      delete attrs[resolvedSourceKey];
    }

    // Update attributeKeys
    const attributeKeys: Array<string> = Object.keys(attrs);

    return { ...logRow, attributes: attrs as JSONObject, attributeKeys };
  }

  private static applySeverityRemapper(
    logRow: JSONObject,
    config: SeverityRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> =
      (logRow["attributes"] as Record<string, unknown>) || {};
    const resolvedSourceKey: string = LogPipelineService.resolveAttributeKey(
      attrs,
      config.sourceKey,
    );
    const sourceVal: unknown = attrs[resolvedSourceKey];
    if (sourceVal === undefined || sourceVal === null) {
      return logRow;
    }

    const sourceStr: string = String(sourceVal).toLowerCase();

    for (const mapping of config.mappings || []) {
      if (mapping.matchValue.toLowerCase() === sourceStr) {
        return {
          ...logRow,
          severityText: mapping.severityText,
          severityNumber: mapping.severityNumber,
        };
      }
    }

    return logRow;
  }

  private static applyCategoryProcessor(
    logRow: JSONObject,
    config: CategoryProcessorConfig,
  ): JSONObject {
    const resolvedTargetKey: string = LogPipelineService.resolveTargetKey(
      config.targetKey,
    );
    for (const category of config.categories || []) {
      if (evaluateFilter(logRow, category.filterQuery)) {
        const attrs: Record<string, unknown> = {
          ...((logRow["attributes"] as Record<string, unknown>) || {}),
        };
        attrs[resolvedTargetKey] = category.name;
        const attributeKeys: Array<string> = Object.keys(attrs);
        return { ...logRow, attributes: attrs as JSONObject, attributeKeys };
      }
    }

    return logRow;
  }
}

export default LogPipelineService;
