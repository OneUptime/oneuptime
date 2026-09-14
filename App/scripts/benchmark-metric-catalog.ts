/*
 * Run from App:
 * node --require ts-node/register/transpile-only scripts/benchmark-metric-catalog.ts
 *
 * Isolates metric catalog construction; does not measure database work or
 * full ingest throughput. The baseline is the former growing-array filter.
 * Includes a single-service export to expose the membership index overhead
 * as well as collector exports combining hundreds/thousands of services.
 */
import { performance } from "perf_hooks";
import MetricCatalog from "../FeatureSet/Telemetry/Utils/MetricCatalog";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

interface Scenario {
  services: number;
  metrics: number;
  repetitions: number;
}

interface Observation {
  name: string;
  description: string;
  unit: string;
  serviceMetadata: {
    primaryEntityId: ObjectID;
    primaryEntityType: ServiceType;
  };
}

interface BenchmarkResult {
  mode: string;
  services: number;
  metrics: number;
  observations: number;
  milliseconds: number;
  cpuMilliseconds: number;
  existingServiceIdReads: number;
}

function observations(scenario: Scenario): Array<Observation> {
  const ids: Array<ObjectID> = Array.from({ length: scenario.services }, () => {
    return ObjectID.generate();
  });
  const result: Array<Observation> = [];
  for (let round: number = 0; round < scenario.repetitions; round++) {
    for (const id of ids) {
      for (let metric: number = 0; metric < scenario.metrics; metric++) {
        result.push({
          name: `metric.${metric}`,
          description: "Benchmark metric",
          unit: "1",
          serviceMetadata: {
            primaryEntityId: id,
            primaryEntityType: ServiceType.OpenTelemetry,
          },
        });
      }
    }
  }
  return result;
}

function measure(
  indexed: boolean,
  scenario: Scenario,
  inputs: Array<Observation>,
): BenchmarkResult {
  const catalog: MetricCatalog = new MetricCatalog();
  const baseline: Dictionary<MetricType> = {};
  let existingServiceIdReads: number = 0;
  const cpuStart: NodeJS.CpuUsage = process.cpuUsage();
  const start: number = performance.now();

  for (const input of inputs) {
    if (indexed) {
      catalog.addMetric(input);
      continue;
    }

    if (!baseline[input.name]) {
      const metric: MetricType = new MetricType();
      metric.name = input.name;
      metric.description = input.description;
      metric.unit = input.unit;
      metric.services = [];
      baseline[input.name] = metric;
    }

    const metric: MetricType = baseline[input.name]!;
    // The historical getter allocates a fresh ObjectID for every read.
    existingServiceIdReads += metric.services!.length;
    if (
      metric.services!.filter((service: Service) => {
        return (
          service.id?.toString() ===
          input.serviceMetadata.primaryEntityId.toString()
        );
      }).length === 0
    ) {
      const service: Service = new Service();
      service.id = input.serviceMetadata.primaryEntityId;
      metric.services!.push(service);
    }
  }

  const milliseconds: number = performance.now() - start;
  const cpu: NodeJS.CpuUsage = process.cpuUsage(cpuStart);
  const output: Dictionary<MetricType> = indexed
    ? catalog.metricNameServiceNameMap
    : baseline;

  if (Object.keys(output).length !== scenario.metrics) {
    throw new Error("Metric count mismatch");
  }
  for (const metric of Object.values(output)) {
    if (!metric || metric.services?.length !== scenario.services) {
      throw new Error("Service link count mismatch");
    }
    const ids: Array<string> = metric.services.map((service: Service) => {
      return service.id!.toString();
    });
    const expected: Array<string> = inputs
      .filter((input: Observation) => {
        return input.name === metric.name;
      })
      .slice(0, scenario.services)
      .map((input: Observation) => {
        return input.serviceMetadata.primaryEntityId.toString();
      });
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error("Service link order mismatch");
    }
  }

  return {
    mode: indexed ? "indexed" : "baseline",
    services: scenario.services,
    metrics: scenario.metrics,
    observations: inputs.length,
    milliseconds: Math.round(milliseconds * 100) / 100,
    cpuMilliseconds: Math.round((cpu.user + cpu.system) / 10) / 100,
    existingServiceIdReads,
  };
}

const warmup: Scenario = { services: 100, metrics: 4, repetitions: 2 };
const warmupInputs: Array<Observation> = observations(warmup);
measure(false, warmup, warmupInputs);
measure(true, warmup, warmupInputs);

const results: Array<BenchmarkResult> = [];
for (const scenario of [
  { services: 1, metrics: 10, repetitions: 1_000 },
  { services: 500, metrics: 4, repetitions: 3 },
  { services: 2_000, metrics: 4, repetitions: 3 },
]) {
  const inputs: Array<Observation> = observations(scenario);
  for (let round: number = 0; round < 3; round++) {
    for (const indexed of round % 2 === 0 ? [false, true] : [true, false]) {
      results.push(measure(indexed, scenario, inputs));
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ node: process.version, results }, null, 2)}\n`,
);
