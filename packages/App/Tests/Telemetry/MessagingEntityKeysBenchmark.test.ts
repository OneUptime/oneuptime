import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The queue-key stamper runs on EVERY span and EVERY datapoint ingest
 * stores, and almost none of them are about a queue. This suite times the
 * gates on realistic rows that are not — the cost every other row pays —
 * and the memo on rows that are. A bound that trips means someone put real
 * work in front of the gate.
 *
 * The loops run in a child Node process that loads the module the way the
 * containers boot (ts-node, TS_NODE_TRANSPILE_ONLY — see
 * TranspileOnlyBoot.test.ts), not inside Jest: Jest runs test code in a vm
 * context where every lookup of a global builtin goes through the context's
 * interceptors, which made the core trigger check (hasMessagingTrigger)
 * several times slower there than in production, so a Jest-side timing
 * would measure Jest. Measured in the child on a development machine:
 * ~0.06 µs per non-messaging span (~0.006 µs for a SERVER span), 0.04–0.09
 * µs per non-messaging datapoint, ~1 µs per memoized messaging span and
 * ~0.5 µs per memoized broker datapoint; an Azure SDK span of a
 * non-messaging client (see AZURE_NON_MESSAGING_CASES) is turned away at
 * the gate like any other non-messaging span. So the 2 s bounds below leave
 * over 15× headroom for a slow CI machine.
 */

const APP_ROOT: string = path.resolve(__dirname, "..", "..");
const RESOLVER_MODULE: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Telemetry",
  "Services",
  "MessagingEntityKeys",
);

const ONE_MILLION: number = 1_000_000;
const HUNDRED_THOUSAND: number = 100_000;
const WARM_UP_ITERATIONS: number = 20_000;
const BUDGET_MS: number = 2_000;

const RESULTS_PREFIX: string = "MESSAGING_ENTITY_KEYS_BENCHMARK ";

interface CaseResult {
  elapsedMs: number;
  iterations: number;
  added: number;
  memoSize: number;
  entityKeysUntouched: boolean;
  // Whether the row passed the gate (isMessagingSpan / isMessagingMetric).
  gate: boolean;
}

// Rows that are not about a queue: 1M gate calls each.
const NON_MESSAGING_CASES: Array<string> = [
  "an HTTP CLIENT span",
  "an INTERNAL span",
  "a SERVER span carrying messaging attributes (turned away by its kind)",
  "a host metric datapoint",
  "a histogram datapoint",
  "a datapoint whose name a pipeline rule upper-cased (the canonicalizing path)",
];

/*
 * Rows that are not about a queue but carry a trigger KEY: the Azure SDKs
 * put `az.namespace` on EVERY span, whatever the client. The core's gate
 * weighs its value (only Microsoft.ServiceBus / Microsoft.EventHub admit a
 * span), so these are turned away at the gate like the rows above: 1M each,
 * gate false, nothing memoized. Before the core weighed the value each paid
 * a memo key and a memoized "no queue", about 1 µs a row.
 */
const AZURE_NON_MESSAGING_CASES: Array<string> = [
  "an Azure Storage blob upload span (az.namespace Microsoft.Storage)",
  "an Azure Cosmos DB span (az.namespace Microsoft.DocumentDB)",
  "an Azure Key Vault INTERNAL span (az.namespace Microsoft.KeyVault)",
];

// Rows that are: 100k memo hits each.
const MEMO_CASES: Array<string> = [
  "a messaging span of one queue",
  "a broker datapoint of one topic",
];

/*
 * The child: plain CommonJS, so only the module under test (and what it
 * imports) goes through ts-node. It prints one line of JSON results.
 */
const CHILD_SOURCE: string = `"use strict";
const MessagingEntityKeyResolver = require(${JSON.stringify(RESOLVER_MODULE)}).default;

const PROJECT_ID = "5f8b9c0d1e2f3a4b5c6d7e8f";
const RESOURCE_KEY = "0123456789abcdef";
const ONE_MILLION = ${ONE_MILLION};
const HUNDRED_THOUSAND = ${HUNDRED_THOUSAND};
const WARM_UP_ITERATIONS = ${WARM_UP_ITERATIONS};

// What a typical instrumented service's resource flattens to on every row.
function withResource(extra) {
  const attributes = {
    "oneuptime.service.id": "0123456789abcdef0123456789abcdef",
    "oneuptime.service.name": "orders-api",
  };
  for (const key of [
    "service.name", "service.version", "service.namespace", "service.instance.id",
    "deployment.environment.name", "host.name", "host.arch", "os.type", "os.description",
    "process.pid", "process.executable.name", "process.runtime.name",
    "process.runtime.version", "telemetry.sdk.name", "telemetry.sdk.language",
    "telemetry.sdk.version", "k8s.cluster.name", "k8s.namespace.name", "k8s.pod.name",
    "k8s.pod.uid", "k8s.node.name", "k8s.deployment.name", "container.id",
    "cloud.provider", "cloud.region",
  ]) {
    attributes["resource." + key] = "value of " + key;
  }
  return Object.assign(attributes, extra);
}

const CASES = [
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[0])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_CLIENT",
      attributes: withResource({
        "http.request.method": "GET",
        "url.full": "https://inventory.example.com/items/42?expand=true",
        "server.address": "inventory.example.com",
        "server.port": 443,
        "http.response.status_code": 200,
        "network.protocol.version": "1.1",
        "user_agent.original": "orders-api/1.4.2",
        "scope.name": "io.opentelemetry.http-url-connection",
        "scope.version": "2.9.0",
      }),
    },
  },
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[1])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_INTERNAL",
      attributes: withResource({
        "code.function.name": "OrderService.price",
        "code.file.path": "/app/src/OrderService.java",
        "code.line.number": 118,
      }),
    },
  },
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[2])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_SERVER",
      attributes: withResource({
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
      }),
    },
  },
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[3])},
    signal: "metric",
    iterations: ONE_MILLION,
    row: {
      name: "system.cpu.utilization",
      attributes: withResource({ cpu: "cpu0", state: "user" }),
    },
  },
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[4])},
    signal: "metric",
    iterations: ONE_MILLION,
    row: {
      name: "http.server.request.duration",
      attributes: withResource({
        "http.request.method": "GET",
        "http.route": "/orders/:id",
        "http.response.status_code": 200,
      }),
    },
  },
  {
    label: ${JSON.stringify(NON_MESSAGING_CASES[5])},
    signal: "metric",
    iterations: ONE_MILLION,
    row: {
      name: "System.CPU.Utilization",
      attributes: withResource({ cpu: "cpu0", state: "user" }),
    },
  },
  {
    label: ${JSON.stringify(AZURE_NON_MESSAGING_CASES[0])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_CLIENT",
      attributes: withResource({
        "az.namespace": "Microsoft.Storage",
        "http.request.method": "PUT",
        "url.full": "https://acct.blob.core.windows.net/container/blob-42",
        "server.address": "acct.blob.core.windows.net",
        "server.port": 443,
        "http.response.status_code": 201,
        "az.client_request_id": "c3f1b0de-0000-4000-8000-000000000042",
        "az.service_request_id": "9a1c-000042",
      }),
    },
  },
  {
    label: ${JSON.stringify(AZURE_NON_MESSAGING_CASES[1])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_CLIENT",
      attributes: withResource({
        "az.namespace": "Microsoft.DocumentDB",
        "db.system": "cosmosdb",
        "db.operation.name": "ReadItem",
        "db.namespace": "orders",
        "db.collection.name": "items",
        "server.address": "acct.documents.azure.com",
        "server.port": 443,
      }),
    },
  },
  {
    label: ${JSON.stringify(AZURE_NON_MESSAGING_CASES[2])},
    signal: "span",
    iterations: ONE_MILLION,
    row: {
      kind: "SPAN_KIND_INTERNAL",
      attributes: withResource({
        "az.namespace": "Microsoft.KeyVault",
        "code.function.name": "SecretClient.GetSecret",
      }),
    },
  },
  {
    label: ${JSON.stringify(MEMO_CASES[0])},
    signal: "span",
    iterations: HUNDRED_THOUSAND,
    reset: true,
    row: {
      kind: "SPAN_KIND_PRODUCER",
      attributes: withResource({
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        "messaging.operation": "publish",
        "messaging.destination.partition.id": "3",
        "messaging.client_id": "producer-1",
        "messaging.kafka.message.offset": 1042,
      }),
    },
  },
  {
    label: ${JSON.stringify(MEMO_CASES[1])},
    signal: "metric",
    iterations: HUNDRED_THOUSAND,
    reset: true,
    row: {
      name: "kafka.consumer_group.lag",
      attributes: withResource({ group: "billing", topic: "orders", partition: 3 }),
    },
  },
];

function measure(iterations, run) {
  for (let index = 0; index < WARM_UP_ITERATIONS; index++) {
    run();
  }
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index++) {
    run();
  }
  return Number(process.hrtime.bigint() - started) / 1000000;
}

const results = {};
for (const testCase of CASES) {
  const resolver = new MessagingEntityKeyResolver(PROJECT_ID);
  const row = Object.assign({ entityKeys: [RESOURCE_KEY] }, testCase.row);
  const originalEntityKeys = row.entityKeys;
  let added = 0;
  const append = testCase.signal === "span"
    ? function () {
        if (testCase.reset) {
          row.entityKeys = [RESOURCE_KEY];
        }
        if (resolver.appendToSpanRow(row)) {
          added++;
        }
      }
    : function () {
        if (testCase.reset) {
          row.entityKeys = [RESOURCE_KEY];
        }
        if (resolver.appendToMetricRow(row)) {
          added++;
        }
      };
  const elapsedMs = measure(testCase.iterations, append);
  results[testCase.label] = {
    elapsedMs: elapsedMs,
    iterations: testCase.iterations,
    added: added,
    memoSize: resolver.memo.size,
    entityKeysUntouched: row.entityKeys === originalEntityKeys,
    gate: testCase.signal === "span"
      ? MessagingEntityKeyResolver.isMessagingSpan(row.attributes, row.kind)
      : MessagingEntityKeyResolver.isMessagingMetric(row.name, row.attributes),
  };
}

process.stdout.write(${JSON.stringify(RESULTS_PREFIX)} + JSON.stringify(results) + "\\n");
`;

let workDirectory: string = "";
let childOutput: string = "";
let results: Record<string, CaseResult> = {};

beforeAll(() => {
  workDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "messaging-entity-keys-benchmark-"),
  );
  const script: string = path.join(workDirectory, "benchmark.js");
  fs.writeFileSync(script, CHILD_SOURCE);

  const child: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--require", "ts-node/register", script],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
      },
      encoding: "utf8",
      timeout: 240_000,
    },
  );

  childOutput = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const line: string | undefined = (child.stdout ?? "")
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(RESULTS_PREFIX);
    });
  results = line
    ? (JSON.parse(line.substring(RESULTS_PREFIX.length)) as Record<
        string,
        CaseResult
      >)
    : {};
}, 300_000);

afterAll(() => {
  if (workDirectory) {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});

describe("the queue-key stamper on the ingest hot path, timed in production's runtime", () => {
  test("every case ran in the child process", () => {
    const expected: Array<string> = [
      ...NON_MESSAGING_CASES,
      ...AZURE_NON_MESSAGING_CASES,
      ...MEMO_CASES,
    ];
    const ran: Array<string> = Object.keys(results);
    expect({
      cases: [...ran].sort(),
      // The child's own output, shown only when it did not run every case.
      output: ran.length === expected.length ? "" : childOutput,
    }).toEqual({ cases: [...expected].sort(), output: "" });
  });

  test.each<[string]>(
    NON_MESSAGING_CASES.map((label: string): [string] => {
      return [label];
    }),
  )(
    "1M × %s: turned away by the gate, under 2 s, nothing stamped, nothing memoized",
    (label: string) => {
      const result: CaseResult | undefined = results[label];
      expect(result).toBeDefined();
      expect(result!.iterations).toBe(ONE_MILLION);
      expect(result!.gate).toBe(false);
      expect(result!.added).toBe(0);
      expect(result!.memoSize).toBe(0);
      expect(result!.entityKeysUntouched).toBe(true);
      expect(result!.elapsedMs).toBeLessThan(BUDGET_MS);
    },
  );

  test.each<[string]>(
    AZURE_NON_MESSAGING_CASES.map((label: string): [string] => {
      return [label];
    }),
  )(
    "1M × %s: an Azure SDK span of a non-messaging client is turned away by the gate on its provider value, under 2 s, nothing stamped, nothing memoized",
    (label: string) => {
      const result: CaseResult | undefined = results[label];
      expect(result).toBeDefined();
      expect(result!.iterations).toBe(ONE_MILLION);
      expect(result!.gate).toBe(false);
      expect(result!.added).toBe(0);
      expect(result!.memoSize).toBe(0);
      expect(result!.entityKeysUntouched).toBe(true);
      expect(result!.elapsedMs).toBeLessThan(BUDGET_MS);
    },
  );

  test.each<[string]>(
    MEMO_CASES.map((label: string): [string] => {
      return [label];
    }),
  )(
    "100k × %s (memo hits): under 2 s, every row stamped, one memo entry",
    (label: string) => {
      const result: CaseResult | undefined = results[label];
      expect(result).toBeDefined();
      expect(result!.iterations).toBe(HUNDRED_THOUSAND);
      expect(result!.gate).toBe(true);
      expect(result!.added).toBe(WARM_UP_ITERATIONS + HUNDRED_THOUSAND);
      expect(result!.memoSize).toBe(1);
      expect(result!.elapsedMs).toBeLessThan(BUDGET_MS);
    },
  );
});
