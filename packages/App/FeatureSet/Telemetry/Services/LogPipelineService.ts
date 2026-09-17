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
  GrokParserConfig,
} from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity, {
  LogSeverityNumber,
  normalizeLogSeverity,
} from "Common/Types/Log/LogSeverity";
import {
  compileFilter,
  CompiledFilter,
  evaluateCompiledFilter,
  getRowFieldValue,
} from "../Utils/LogFilterEvaluator";
import {
  CompiledGrokPattern,
  GrokValue,
  compileGrokPatternCached,
  matchGrokPattern,
} from "Common/Utils/Grok/Grok";
import logger from "Common/Server/Utils/Logger";
import PipelineCache from "../Utils/PipelineCache";
import getPipelineProcessorConfig from "../Utils/PipelineProcessorConfig";

export interface LoadedPipeline {
  pipeline: LogPipeline;
  /*
   * Pre-compiled at cache load time so per-record evaluation
   * doesn't re-tokenize / re-parse the filterQuery string on
   * every log. See LogFilterEvaluator.compileFilter.
   */
  compiledFilter: CompiledFilter;
  processors: Array<LogPipelineProcessor>;
}

/*
 * Cached category-filter compilation lives on the processor's
 * configuration object directly (we mutate `_compiledCategoryFilters`
 * into the JSONB blob). The cache holds the same processor object
 * for 60s so the compile cost is paid once per category per
 * pipeline-reload window, not once per record.
 */
interface CompiledCategoryConfig extends CategoryProcessorConfig {
  _compiledCategoryFilters?: Array<CompiledFilter>;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

/*
 * A grok pattern that does not compile cannot be fixed by retrying it,
 * and applyProcessor runs once per record - logging the failure per
 * record would turn one bad processor into an unbounded error stream.
 * Save-time validation rejects most of these; this covers processors
 * saved before that validation existed and ones written through the API
 * with hooks skipped.
 */
const MAX_LOGGED_INVALID_GROK_PATTERNS: number = 1000;
const loggedInvalidGrokPatterns: Set<string> = new Set<string>();

const pipelineCache: PipelineCache<Array<LoadedPipeline>> = new PipelineCache<
  Array<LoadedPipeline>
>(MAX_CACHED_PROJECTS, CACHE_TTL_MS);

export class LogPipelineService {
  public static async loadPipelines(
    projectId: ObjectID,
  ): Promise<Array<LoadedPipeline>> {
    return pipelineCache.getOrLoad(projectId.toString(), () => {
      return LogPipelineService.loadPipelinesFromDatabase(projectId);
    });
  }

  private static async loadPipelinesFromDatabase(
    projectId: ObjectID,
  ): Promise<Array<LoadedPipeline>> {
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

      loaded.push({
        pipeline,
        compiledFilter: compileFilter((pipeline.filterQuery as string) || ""),
        processors,
      });
    }

    return loaded;
  }

  public static processLog(
    logRow: JSONObject,
    pipelines: Array<LoadedPipeline>,
  ): JSONObject {
    let result: JSONObject = { ...logRow };

    for (const { pipeline, compiledFilter, processors } of pipelines) {
      // Check if this pipeline's filter matches the log
      if (!evaluateCompiledFilter(result, compiledFilter)) {
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
    const config: JSONObject = getPipelineProcessorConfig(processor);

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
          config as unknown as CompiledCategoryConfig,
        );
      case LogPipelineProcessorType.GrokParser:
        return LogPipelineService.applyGrokParser(
          logRow,
          config as unknown as GrokParserConfig,
          processor.name || "",
        );
      default:
        return logRow;
    }
  }

  /*
   * Grok: pull structured fields out of an unstructured line.
   *
   * `source` names the field to parse and resolves the same way a filter
   * query's field does ("body", "attributes.message", or a bare
   * attribute key); it defaults to the log body, which is what a grok
   * processor is for. Extracted fields land in the log's attributes,
   * under `targetPrefix` when one is configured, so they are searchable
   * and filterable like any other attribute.
   *
   * The pattern is compiled once per distinct pattern text and reused
   * (see compileGrokPatternCached) - never per record.
   */
  private static applyGrokParser(
    logRow: JSONObject,
    config: GrokParserConfig,
    processorName: string,
  ): JSONObject {
    const pattern: string = (config.pattern || "").trim();

    if (!pattern) {
      return logRow;
    }

    const sourceField: string = (config.source || "").trim() || "body";

    let compiled: CompiledGrokPattern;

    try {
      compiled = compileGrokPatternCached(pattern);
    } catch (err) {
      LogPipelineService.logInvalidGrokPatternOnce(processorName, pattern, err);
      return logRow;
    }

    const sourceValue: string = getRowFieldValue(logRow, sourceField);

    if (!sourceValue) {
      return logRow;
    }

    const extracted: Record<string, GrokValue> | null = matchGrokPattern(
      compiled,
      sourceValue,
    );

    /*
     * No match is not an error - a pipeline filter is usually broader
     * than the one line shape a pattern describes. The log passes
     * through untouched.
     */
    if (!extracted) {
      return logRow;
    }

    const fieldNames: Array<string> = Object.keys(extracted);

    if (fieldNames.length === 0) {
      return logRow;
    }

    const prefix: string = LogPipelineService.normalizeGrokTargetPrefix(
      config.targetPrefix,
    );

    const attrs: Record<string, unknown> = {
      ...((logRow["attributes"] as Record<string, unknown>) || {}),
    };

    for (const fieldName of fieldNames) {
      attrs[`${prefix}${fieldName}`] = extracted[fieldName];
    }

    const attributeKeys: Array<string> = Object.keys(attrs);

    return { ...logRow, attributes: attrs as JSONObject, attributeKeys };
  }

  /*
   * A prefix of "http" is meant as a namespace, not as a string to jam
   * onto the front of the field name, so a separator is added unless the
   * user already ended it with one: "http" + "status" => "http.status",
   * while "http_" + "status" stays "http_status".
   */
  private static normalizeGrokTargetPrefix(
    targetPrefix: string | undefined,
  ): string {
    const prefix: string = (targetPrefix || "").trim();

    if (!prefix) {
      return "";
    }

    if (
      prefix.endsWith(".") ||
      prefix.endsWith("_") ||
      prefix.endsWith("-") ||
      prefix.endsWith(":")
    ) {
      return prefix;
    }

    return `${prefix}.`;
  }

  private static logInvalidGrokPatternOnce(
    processorName: string,
    pattern: string,
    err: unknown,
  ): void {
    if (loggedInvalidGrokPatterns.has(pattern)) {
      return;
    }

    if (loggedInvalidGrokPatterns.size >= MAX_LOGGED_INVALID_GROK_PATTERNS) {
      loggedInvalidGrokPatterns.clear();
    }

    loggedInvalidGrokPatterns.add(pattern);

    logger.error(
      `Grok processor "${processorName}" has a pattern that does not compile and will not run: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  private static applyAttributeRemapper(
    logRow: JSONObject,
    config: AttributeRemapperConfig,
  ): JSONObject {
    const attrs: Record<string, unknown> = {
      ...((logRow["attributes"] as Record<string, unknown>) || {}),
    };

    const sourceVal: unknown = attrs[config.sourceKey];
    if (sourceVal === undefined) {
      return logRow;
    }

    const overrideOnConflict: boolean = config.overrideOnConflict !== false;
    if (!overrideOnConflict && attrs[config.targetKey] !== undefined) {
      return logRow;
    }

    attrs[config.targetKey] = sourceVal;

    if (!config.preserveSource) {
      delete attrs[config.sourceKey];
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
    const sourceVal: unknown = attrs[config.sourceKey];
    if (sourceVal === undefined || sourceVal === null) {
      return logRow;
    }

    const sourceStr: string = String(sourceVal).toLowerCase();

    for (const mapping of config.mappings || []) {
      if (mapping.matchValue.toLowerCase() === sourceStr) {
        /*
         * Normalise rather than trusting the stored config. Pipelines saved
         * before the severity dropdown was fixed hold "INFO" / "WARNING",
         * which are not LogSeverity members — writing them verbatim put a
         * severityText on the row that no filter can ever match, since ingest
         * only ever produces the seven enum values and `=` is case-sensitive.
         * Those configs are still live, so the correction has to happen here
         * rather than only in the UI.
         */
        const severity: LogSeverity | null = normalizeLogSeverity(
          mapping.severityText,
        );

        if (!severity) {
          /*
           * Unrecognised: leave the ingest-derived severity alone rather than
           * overwrite it with something unmatchable.
           */
          return logRow;
        }

        return {
          ...logRow,
          severityText: severity,
          severityNumber: LogSeverityNumber[severity],
        };
      }
    }

    return logRow;
  }

  private static applyCategoryProcessor(
    logRow: JSONObject,
    config: CompiledCategoryConfig,
  ): JSONObject {
    const categories: CategoryProcessorConfig["categories"] =
      config.categories || [];
    if (categories.length === 0) {
      return logRow;
    }

    /*
     * Lazy-compile category filters on first hit. We mutate the
     * (cached, in-memory) config object so subsequent records
     * skip the compile entirely. The pipeline cache holds this
     * object for the 60s TTL window.
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
      if (evaluateCompiledFilter(logRow, compiled)) {
        const attrs: Record<string, unknown> = {
          ...((logRow["attributes"] as Record<string, unknown>) || {}),
        };
        attrs[config.targetKey] = category.name;
        const attributeKeys: Array<string> = Object.keys(attrs);
        return { ...logRow, attributes: attrs as JSONObject, attributeKeys };
      }
    }

    return logRow;
  }
}

export default LogPipelineService;
