import "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { after, before, beforeEach, test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import {
  EnginePricing,
  LIST_PRICE_PROVIDERS,
  OPENCOST_DEFAULT_CPU_RATE,
  OPENCOST_DEFAULT_RAM_RATE,
  describeEnginePricing,
  isOpenCostDefaultRates,
  readEnginePricing,
} from "../EnginePricing";

/*
 * #9634: the Costs page and the overview say where a cluster's prices come
 * from. The engine is asked: /clusterInfo for the provider it priced the
 * nodes by, and for a cluster no cloud's list prices cover, /allNodePricing
 * for the rates in force.
 */

const DEFAULT_RATES: unknown = {
  default: { CPU: "0.031611", RAM: "0.004237", GPU: "" },
  "default,spot": { CPU: "0.006655", RAM: "0.000892", GPU: "" },
};

const OWN_RATES: unknown = {
  default: { CPU: "0.02", RAM: "0.003", GPU: "" },
};

test("a cloud OpenCost recognises is priced at that cloud's list prices", (): void => {
  for (const provider of LIST_PRICE_PROVIDERS) {
    assert.deepStrictEqual(
      describeEnginePricing({ clusterInfo: { provider, region: "x" } }),
      { source: "list-prices", provider },
    );
  }
});

test("names the provider as OpenCost does, whatever case the engine wrote it in", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({ clusterInfo: { provider: "aws" } }),
    { source: "list-prices", provider: "AWS" },
  );
});

test("a cloud keeps its list prices even with a rate card the chart set", (): void => {
  /*
   * OpenCost prices a known instance type at the cloud's price whatever the
   * rate card says; the rate card only prices what the list lacks.
   */
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "Azure" },
      rateCardHint: "true",
    }),
    { source: "list-prices", provider: "Azure" },
  );
});

test("no cloud and OpenCost's own rates: its default rates", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: DEFAULT_RATES,
    }),
    { source: "default-rates", provider: "" },
  );
});

test("no cloud and rates of someone's own: a rate card", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: OWN_RATES,
    }),
    { source: "rate-card", provider: "" },
  );
});

test("the engine's rates win over the chart's word about them", (): void => {
  // A rate card enabled with the defaults left in is still the defaults.
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: DEFAULT_RATES,
      rateCardHint: "true",
    }).source,
    "default-rates",
  );
});

test("a CSV price list is a rate card", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({ clusterInfo: { provider: "CSV" } }),
    { source: "rate-card", provider: "" },
  );
});

test("when the engine cannot say, the chart's word about its bundled engine decides", (): void => {
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: null, rateCardHint: "true" }).source,
    "rate-card",
  );
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: null, rateCardHint: "false" }).source,
    "default-rates",
  );
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: null,
      rateCardHint: "false",
    }).source,
    "default-rates",
  );
});

test("an engine that says nothing, with no word from the chart, is unknown rather than guessed", (): void => {
  assert.deepStrictEqual(describeEnginePricing({ clusterInfo: null }), {
    source: "unknown",
    provider: "",
  });
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: { provider: "-" } }).source,
    "unknown",
  );
  // A provider OpenCost does not price at list prices is not taken for one.
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "SomeNewCloud" },
      rateCardHint: "false",
    }).source,
    "unknown",
  );
});

test("isOpenCostDefaultRates compares the default CPU and RAM rates as numbers", (): void => {
  assert.strictEqual(OPENCOST_DEFAULT_CPU_RATE, 0.031611);
  assert.strictEqual(OPENCOST_DEFAULT_RAM_RATE, 0.004237);
  assert.strictEqual(isOpenCostDefaultRates(DEFAULT_RATES), true);
  assert.strictEqual(
    isOpenCostDefaultRates({ default: { CPU: 0.031611, RAM: "0.0042370" } }),
    true,
  );
  assert.strictEqual(isOpenCostDefaultRates(OWN_RATES), false);
  assert.strictEqual(
    isOpenCostDefaultRates({ default: { CPU: "0.031611", RAM: "0.005" } }),
    false,
  );
  assert.strictEqual(isOpenCostDefaultRates({}), null);
  assert.strictEqual(isOpenCostDefaultRates({ default: {} }), null);
  assert.strictEqual(isOpenCostDefaultRates("nope"), null);
});

// --- Asking a real (stub) engine ---------------------------------------------

let server: http.Server;
let baseUrl: string = "";
let requested: Array<string> = [];
let routes: Record<string, { status: number; body: unknown }> = {};

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const path: string = (req.url || "").split("?")[0] || "";
      requested.push(path);
      const route: { status: number; body: unknown } | undefined = routes[path];
      res.writeHead(route ? route.status : 404, {
        "Content-Type": "application/json",
      });
      res.end(
        !route
          ? ""
          : typeof route.body === "string"
            ? route.body
            : JSON.stringify(route.body),
      );
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

beforeEach((): void => {
  requested = [];
  routes = {};
});

const ALLOCATIONS: { status: number; body: unknown } = {
  status: 200,
  body: { code: 200, data: [{}] },
};

const WINDOW: { windowStart: Date; windowEnd: Date } = {
  windowStart: new Date("2026-11-18T10:00:00Z"),
  windowEnd: new Date("2026-11-18T11:00:00Z"),
};

test("asks OpenCost at the root, and only its cluster info for a cloud", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    "/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "GCP", id: "prod-eu" } },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  const pricing: EnginePricing = await readEnginePricing({ client });

  assert.deepStrictEqual(pricing, { source: "list-prices", provider: "GCP" });
  // The cloud's whole price list is never asked for.
  assert.ok(!requested.includes("/allNodePricing"));
});

test("asks Kubecost under /model, where its frontend serves the cost model", async (): Promise<void> => {
  routes = {
    "/model/allocation": ALLOCATIONS,
    "/model/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "custom" } },
    },
    "/model/allNodePricing": {
      status: 200,
      body: { code: 200, data: OWN_RATES },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(client.engineKind(), "Kubecost");
  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "rate-card",
    provider: "",
  });
  assert.ok(requested.includes("/model/clusterInfo"));
  assert.ok(requested.includes("/model/allNodePricing"));
});

test("an engine whose cluster info will not answer is unknown, and nothing throws", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    "/clusterInfo": { status: 500, body: { code: 500, message: "boom" } },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(client.engineKind(), "OpenCost");
  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "unknown",
    provider: "",
  });
  // ...unless the chart says what it gave its own engine.
  assert.strictEqual(
    (await readEnginePricing({ client, rateCardHint: "false" })).source,
    "default-rates",
  );
});

test("an answer that is not JSON is no answer", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    // A frontend that serves its single-page app for any path it does not know.
    "/clusterInfo": { status: 200, body: "<!doctype html><html></html>" },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(await client.fetchApiData("clusterInfo"), null);
});
