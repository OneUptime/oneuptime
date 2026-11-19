import "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { after, before, test } from "node:test";
import { PrometheusVectorSample, queryPrometheus } from "../PrometheusQuery";

/*
 * One instant query against a Prometheus, for the check that tells whether a
 * cluster's own engine's Prometheus has cAdvisor's memory series (#9777) and
 * for the peaks themselves. Against a stand-in on a port of its own.
 */

interface Asked {
  path: string;
  query: string;
  time: string | null;
}

let server: http.Server;
let base: string = "";
let asked: Array<Asked> = [];
let answer: { status: number; type: string; body: string } = {
  status: 200,
  type: "application/json",
  body: "",
};

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const url: URL = new URL(req.url || "/", "http://localhost");
      asked.push({
        path: url.pathname,
        query: url.searchParams.get("query") || "",
        time: url.searchParams.get("time"),
      });
      res.writeHead(answer.status, { "Content-Type": answer.type });
      res.end(answer.body);
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

const respond: (status: number, body: unknown, type?: string) => void = (
  status: number,
  body: unknown,
  type?: string,
): void => {
  asked = [];
  answer = {
    status,
    type: type || "application/json",
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
};

test("asks /api/v1/query under the address, path prefix and all", async (): Promise<void> => {
  respond(200, {
    status: "success",
    data: {
      resultType: "vector",
      result: [
        {
          metric: { job: "kubernetes-nodes-cadvisor" },
          value: [1795104088.4, "27"],
        },
      ],
    },
  });

  const samples: Array<PrometheusVectorSample> = await queryPrometheus(
    `${base}/prometheus/`,
    'count by (job) (container_memory_working_set_bytes{container!=""})',
  );

  assert.deepStrictEqual(samples, [
    { metric: { job: "kubernetes-nodes-cadvisor" }, value: 27 },
  ]);
  assert.deepStrictEqual(asked, [
    {
      path: "/prometheus/api/v1/query",
      query:
        'count by (job) (container_memory_working_set_bytes{container!=""})',
      time: null,
    },
  ]);
});

test("evaluates at the time asked, in whole seconds", async (): Promise<void> => {
  respond(200, {
    status: "success",
    data: { resultType: "vector", result: [] },
  });

  await queryPrometheus(base, "up", {
    time: new Date("2026-11-19T12:00:00.750Z"),
  });

  // 2026-11-19T12:00:00Z, the milliseconds dropped.
  assert.strictEqual(asked[0]!.time, "1795089600");
});

test("drops samples that are not a number", async (): Promise<void> => {
  respond(200, {
    status: "success",
    data: {
      resultType: "vector",
      result: [
        { metric: { container: "a" }, value: [1, "NaN"] },
        { metric: { container: "b" }, value: [1, "+Inf"] },
        { metric: { container: "c" } },
        { metric: { container: "d" }, value: [1, "42"] },
      ],
    },
  });

  assert.deepStrictEqual(await queryPrometheus(base, "x"), [
    { metric: { container: "d" }, value: 42 },
  ]);
});

test("an HTTP error, an answer that is not JSON, and Prometheus' own error each say so", async (): Promise<void> => {
  respond(401, "Unauthorized", "text/plain");
  await assert.rejects(
    queryPrometheus(base, "up"),
    /answered HTTP 401: Unauthorized/,
  );

  respond(200, "<!DOCTYPE html><html>Grafana</html>", "text/html");
  await assert.rejects(queryPrometheus(base, "up"), /not Prometheus' JSON/);

  respond(200, {
    status: "error",
    errorType: "bad_data",
    error: "parse error",
  });
  await assert.rejects(
    queryPrometheus(base, "up"),
    /answered the query with status error: parse error/,
  );
});

test("an address that does not answer is an error, not a hang", async (): Promise<void> => {
  const closed: http.Server = http.createServer();
  await new Promise<void>((resolve: () => void): void => {
    closed.listen(0, "127.0.0.1", resolve);
  });
  const port: number = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve: () => void): void => {
    closed.close((): void => {
      resolve();
    });
  });

  await assert.rejects(
    queryPrometheus(`http://127.0.0.1:${port}`, "up"),
    /ECONNREFUSED/,
  );
});

test("a Prometheus that hangs is given up on at the timeout", async (): Promise<void> => {
  const hanging: http.Server = http.createServer((): void => {
    // Never answers.
  });
  await new Promise<void>((resolve: () => void): void => {
    hanging.listen(0, "127.0.0.1", resolve);
  });
  const port: number = (hanging.address() as AddressInfo).port;

  await assert.rejects(
    queryPrometheus(`http://127.0.0.1:${port}`, "up", { timeoutMs: 200 }),
    /timed out after 200ms/,
  );

  hanging.closeAllConnections();
  await new Promise<void>((resolve: () => void): void => {
    hanging.close((): void => {
      resolve();
    });
  });
});
