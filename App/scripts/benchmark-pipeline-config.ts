/*
 * Run from App:
 * node --require ts-node/register/transpile-only scripts/benchmark-pipeline-config.ts
 *
 * Measures configuration normalization + category filter evaluation only.
 * The baseline reproduces the previous string-config path. Neither mode
 * includes database access, row construction or the rest of telemetry ingest.
 */
import { performance } from "perf_hooks";
import getPipelineProcessorConfig from "../FeatureSet/Telemetry/Utils/PipelineProcessorConfig";
import {
  compileFilter,
  CompiledFilter,
  evaluateCompiledFilter,
} from "../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { JSONObject } from "Common/Types/JSON";

interface CategoryConfig {
  categories: Array<{ name: string; filterQuery: string }>;
  _compiledCategoryFilters?: Array<CompiledFilter>;
}

interface BenchmarkResult {
  mode: string;
  records: number;
  milliseconds: number;
  cpuMilliseconds: number;
  configurationsParsed: number;
  filtersCompiled: number;
  matches: number;
}

const recordCount: number = 100_000;
const rounds: number = 5;
const configuration: string = JSON.stringify({
  categories: Array.from({ length: 8 }, (_: unknown, index: number) => {
    return {
      name: `category-${index}`,
      filterQuery: `attributes.level = 'level-${index}' AND body LIKE 'request %'`,
    };
  }),
});
const row: JSONObject = {
  body: "request failed",
  attributes: { level: "level-7" },
};

function measure(cached: boolean, records: number): BenchmarkResult {
  const processor: { configuration: string } = { configuration };
  let filtersCompiled: number = 0;
  let matches: number = 0;
  const cpuStart: NodeJS.CpuUsage = process.cpuUsage();
  const start: number = performance.now();

  for (let index: number = 0; index < records; index++) {
    const config: CategoryConfig = cached
      ? (getPipelineProcessorConfig(processor) as unknown as CategoryConfig)
      : (JSON.parse(processor.configuration) as CategoryConfig);

    if (!config._compiledCategoryFilters) {
      filtersCompiled += config.categories.length;
      config._compiledCategoryFilters = config.categories.map(
        (category: CategoryConfig["categories"][number]) => {
          return compileFilter(category.filterQuery);
        },
      );
    }

    for (const filter of config._compiledCategoryFilters) {
      if (evaluateCompiledFilter(row, filter)) {
        matches++;
        break;
      }
    }
  }

  const milliseconds: number = performance.now() - start;
  const cpu: NodeJS.CpuUsage = process.cpuUsage(cpuStart);
  return {
    mode: cached ? "cached" : "baseline",
    records,
    milliseconds: Math.round(milliseconds * 100) / 100,
    cpuMilliseconds: Math.round((cpu.user + cpu.system) / 10) / 100,
    configurationsParsed: cached ? 1 : records,
    filtersCompiled,
    matches,
  };
}

measure(false, 5_000);
measure(true, 5_000);

const results: Array<BenchmarkResult> = [];
for (let round: number = 0; round < rounds; round++) {
  // Alternate ordering to reduce warmup and thermal bias.
  for (const cached of round % 2 === 0 ? [false, true] : [true, false]) {
    const result: BenchmarkResult = measure(cached, recordCount);
    if (result.matches !== recordCount) {
      throw new Error(
        `Category evaluation mismatch: ${JSON.stringify(result)}`,
      );
    }
    results.push(result);
  }
}

process.stdout.write(
  `${JSON.stringify({ node: process.version, results }, null, 2)}\n`,
);
