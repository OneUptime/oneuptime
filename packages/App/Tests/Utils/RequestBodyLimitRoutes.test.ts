import GzipRequestBodyMiddleware from "Common/Server/Middleware/GzipRequestBody";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import getRequestBodyLimit, {
  FILE_REQUEST_BODY_LIMIT,
  INCOMING_REQUEST_ROUTE_PREFIXES,
  LARGE_REQUEST_BODY_LIMIT,
  ORDINARY_REQUEST_BODY_LIMIT,
  PROBE_INGEST_ROUTE_PREFIXES,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
  SERVER_MONITOR_ROUTE_PREFIXES,
  TELEMETRY_ROUTE_PREFIXES,
} from "Common/Server/Utils/RequestBodyLimit";
import { TELEMETRY_WRITER_INSERT_ROUTE } from "Common/Server/Utils/Telemetry/TelemetryWriterClient";
import {
  isCloudStreamPath,
  isVercelLogDrainPath,
} from "Common/Server/Utils/StartServer";
import { isCompatibleIngestPath } from "Common/Types/Telemetry/CompatibleIngest";
import {
  DATA_SECURITY_PROBE_RESULT_ROUTE,
  DATA_SECURITY_PROBE_WORK_ROUTE,
} from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
} from "Common/Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import { FileRoute } from "Common/ServiceRoute";
import { parseInflatedJsonBody as parseVMwareCollection } from "../../FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection";
import { parseInflatedJsonBody as parseOpenStackCollection } from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import zlib from "zlib";

/*
 * THE LIMIT EACH OF THE APP'S ROUTES HOLDS A BODY TO (#10183).
 *
 * StartServer chooses a body's limit from its path before routing
 * (Common/Server/Utils/RequestBodyLimit): 1 MB and 100,000 JSON values for
 * almost every route, 50 MiB for the routes listed as taking more. The list
 * is matched as the App mounts its routers, so the prefixes it names are
 * read here from where the App mounts them, and the paths the App's own
 * clients send to - a probe, an agent, the Dashboard's upload, the workers'
 * notifications - are held to what each takes.
 */

const APP: string = path.resolve(__dirname, "..", "..");

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(APP, relativePath), "utf8");
};

// An array literal of strings named `name` in source, as written.
const readStringArray: (source: string, name: string) => Array<string> = (
  source: string,
  name: string,
): Array<string> => {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}: Array<string> = \\[([^\\]]*)\\]`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return Array.from(match![1]!.matchAll(/"([^"]*)"/g)).map(
    (item: RegExpMatchArray): string => {
      return item[1]!;
    },
  );
};

// "/" is the root: "" before a route's own path.
const asPrefixes: (mounts: Array<string>) => Array<string> = (
  mounts: Array<string>,
): Array<string> => {
  return mounts.map((mount: string): string => {
    return mount === "/" ? "" : mount;
  });
};

describe("the prefixes the list is matched under are the ones the App mounts its routers on", () => {
  const telemetryIndex: string = readSource("FeatureSet/Telemetry/Index.ts");

  test.each([
    ["TELEMETRY_PREFIXES", TELEMETRY_ROUTE_PREFIXES],
    ["PROBE_INGEST_PREFIXES", PROBE_INGEST_ROUTE_PREFIXES],
    ["SERVER_MONITOR_PREFIXES", SERVER_MONITOR_ROUTE_PREFIXES],
    ["INCOMING_REQUEST_PREFIXES", INCOMING_REQUEST_ROUTE_PREFIXES],
  ])("%s", (name: string, prefixes: ReadonlyArray<string>) => {
    expect(asPrefixes(readStringArray(telemetryIndex, name))).toEqual([
      ...prefixes,
    ]);
  });
});

describe("the paths the App's own clients send large bodies to", () => {
  const under: (
    prefixes: ReadonlyArray<string>,
    route: string,
  ) => Array<string> = (
    prefixes: ReadonlyArray<string>,
    route: string,
  ): Array<string> => {
    return prefixes.map((prefix: string): string => {
      return `${prefix}${route}`;
    });
  };

  test.each([
    // The Dashboard's upload: nginx sends /file to /api/file.
    [
      "a file the Dashboard uploads",
      [`/api${FileRoute.toString()}`],
      FILE_REQUEST_BODY_LIMIT,
    ],
    [
      "a vCenter's collection",
      under(PROBE_INGEST_ROUTE_PREFIXES, "/probe/vmware/collection"),
      REPORT_REQUEST_BODY_LIMIT,
    ],
    [
      "an OpenStack cloud's collection",
      under(PROBE_INGEST_ROUTE_PREFIXES, "/probe/openstack/collection"),
      REPORT_REQUEST_BODY_LIMIT,
    ],
    [
      "a forwarding pod's ClickHouse rows",
      [TELEMETRY_WRITER_INSERT_ROUTE],
      REPORT_REQUEST_BODY_LIMIT,
    ],
    [
      "a probe's monitor result, with its screenshots",
      under(PROBE_INGEST_ROUTE_PREFIXES, "/probe/response/ingest"),
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "a probe's packet capture",
      under(
        PROBE_INGEST_ROUTE_PREFIXES,
        "/probe/packet-capture/response/ingest",
      ),
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "a probe's data store scans",
      [
        ...under(PROBE_INGEST_ROUTE_PREFIXES, DATA_SECURITY_PROBE_RESULT_ROUTE),
        ...under(PROBE_INGEST_ROUTE_PREFIXES, DATA_SECURITY_PROBE_WORK_ROUTE),
        ...under(
          PROBE_INGEST_ROUTE_PREFIXES,
          DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
        ),
        ...under(
          PROBE_INGEST_ROUTE_PREFIXES,
          DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
        ),
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "an inbound email",
      [
        "/incoming-email/sendgrid/secret",
        "/probe-ingest/incoming-email/sendgrid/secret",
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "the infrastructure agent's report",
      under(
        SERVER_MONITOR_ROUTE_PREFIXES,
        "/server-monitor/response/ingest/key",
      ),
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "an incoming request monitor's webhook, and a heartbeat nginx sends there",
      under(INCOMING_REQUEST_ROUTE_PREFIXES, "/incoming-request/key"),
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "telemetry the StartServer parsers read",
      [
        ...under(TELEMETRY_ROUTE_PREFIXES, "/fluentd/v1/logs"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/syslog/v1/logs"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/security-events/v1/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/kubernetes-cost/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/change-events/v1/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/openlineage/api/v1/lineage"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/dbt/v1/artifacts"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/source-maps/v1/upload"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/dsyms/v1/upload"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/pyroscope/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/opamp/v1"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/android-agent/v1/log-sessions"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/fivetran/v1/webhook/id"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/airbyte/v1/webhook/key"),
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "a workflow's webhook trigger and the builder's save",
      [
        "/workflow/manual/run/id",
        "/workflow/update/id",
        "/workflow/trigger/key",
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "Huntress's incident reports",
      [`/api${HUNTRESS_WEBHOOK_ROUTE}/key`],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "an agent's job result",
      [
        "/runner-ingest/job/id/result",
        "/runbook-agent-ingest/job/id/result",
        "/kubernetes-ai-agent-ingest/job/id/result",
        "/resource-ai-agent-ingest/job/id/result",
        "/api/ai-agent-data/llm-completion",
        "/api/ai-agent-task-log/create-log",
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "the workers' emails and outgoing webhooks",
      ["/api/notification/email/send", "/api/notification/webhook/send"],
      LARGE_REQUEST_BODY_LIMIT,
    ],
  ])("%s", (_what: string, paths: Array<string>, limit: RequestBodyLimit) => {
    for (const route of paths) {
      expect({ route, limit: getRequestBodyLimit(route) }).toEqual({
        route,
        limit: limit,
      });
    }
  });

  test("the routes are still where the list says: their routers register them", () => {
    for (const [file, route] of [
      [
        "FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection.ts",
        '"/probe/vmware/collection"',
      ],
      [
        "FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection.ts",
        '"/probe/openstack/collection"',
      ],
      [
        "FeatureSet/Telemetry/API/ProbeIngest/Probe.ts",
        '"/probe/response/ingest"',
      ],
      [
        "FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail.ts",
        '"/incoming-email/sendgrid/:secret"',
      ],
      [
        "FeatureSet/Telemetry/API/ServerMonitorIngest/ServerMonitor.ts",
        '"/server-monitor/response/ingest/:secretkey"',
      ],
      [
        "FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
        '"/incoming-request/:secretkey"',
      ],
      ["FeatureSet/Telemetry/API/Fluent.ts", '"/fluentd/v1/logs"'],
      ["FeatureSet/Telemetry/API/DbtArtifactsIngest.ts", '"/dbt/v1/artifacts"'],
      [
        "FeatureSet/Telemetry/API/SourceMapIngest.ts",
        '"/source-maps/v1/upload"',
      ],
    ] as Array<[string, string]>) {
      expect({ file, registers: readSource(file).includes(route) }).toEqual({
        file,
        registers: true,
      });
    }
  });

  /*
   * A telemetry route a body comes in by - a collector's, an agent's, CI's -
   * is mounted on TELEMETRY_PREFIXES. Each one StartServer reads the body of
   * takes a large route's limit; the rest read their own (OTLP, session
   * replay, the compatible endpoints, the Vercel log drain, the cloud
   * streams). A route added there without either fails here.
   */
  test("every telemetry route that takes a body StartServer reads is a large one", () => {
    const telemetryIndex: string = readSource("FeatureSet/Telemetry/Index.ts");
    const mounted: Array<string> = Array.from(
      telemetryIndex.matchAll(/app\.use\(TELEMETRY_PREFIXES, (\w+)\);/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(mounted.length).toBeGreaterThan(20);

    const checked: Array<string> = [];

    for (const name of mounted) {
      const imported: RegExpMatchArray | null = telemetryIndex.match(
        new RegExp(`import ${name} from "\\./API/([\\w/]+)";`),
      );

      expect({ name, imported: Boolean(imported) }).toEqual({
        name,
        imported: true,
      });

      const source: string = readSource(
        `FeatureSet/Telemetry/API/${imported![1]}.ts`,
      );

      for (const match of source.matchAll(
        /\.(?:post|put|patch)\(\s*"([^"]+)"/g,
      )) {
        const route: string = match[1]!;

        for (const prefix of TELEMETRY_ROUTE_PREFIXES) {
          const path: string = `${prefix}${route}`;
          const readsItsOwnBody: boolean =
            path.includes("/otlp/v1/") ||
            path.includes("/session-replay/v1/") ||
            isVercelLogDrainPath(path) ||
            isCloudStreamPath(path) ||
            isCompatibleIngestPath(path);

          if (!readsItsOwnBody) {
            expect({
              path,
              bytes: getRequestBodyLimit(path).bytes,
            }).toEqual({ path, bytes: LARGE_REQUEST_BODY_LIMIT.bytes });
            checked.push(path);
          }
        }
      }
    }

    expect(checked).toEqual(
      expect.arrayContaining([
        "/dsyms/v1/upload",
        "/telemetry/fluentd/v1/logs",
      ]),
    );
  });

  test("an ordinary route of the API takes the ordinary limit", () => {
    for (const route of [
      "/api/monitor",
      "/api/monitor/get-list",
      "/api/incident/id",
      "/api/telemetry/logs/histogram",
      "/api/identity/login",
      "/api/status-page/overview/id",
      "/api/notification-rule/get-list",
    ]) {
      expect({ route, limit: getRequestBodyLimit(route) }).toEqual({
        route,
        limit: ORDINARY_REQUEST_BODY_LIMIT,
      });
    }
  });
});

/*
 * A probe's collection reaches the route as the bytes the gzip reader
 * inflated, whatever its Content-Type said - one that is not JSON's is not
 * counted as it inflates - and is parsed before the probe is authenticated
 * from it. It is counted before it is parsed.
 */
describe("a collection is counted before it is parsed", () => {
  function gzipRequest(body: Buffer, contentType: string): ExpressRequest {
    const stream: PassThrough = new PassThrough();
    const req: ExpressRequest = stream as unknown as ExpressRequest;

    (req as unknown as { headers: Record<string, string> }).headers = {
      "content-encoding": "gzip",
      "content-type": contentType,
      "content-length": String(body.length),
    };

    setImmediate(() => {
      stream.end(body);
    });

    return req;
  }

  function run(
    middleware: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void,
    req: ExpressRequest,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve: (value: unknown) => void) => {
      middleware(
        req,
        {} as ExpressResponse,
        ((error?: unknown) => {
          resolve(error);
        }) as NextFunction,
      );
    });
  }

  const bomb: Buffer = Buffer.from(
    `[${"[],".repeat(Math.floor((20 * 1024 * 1024) / 3))}[]]`,
  );

  test.each([
    ["a vCenter's", parseVMwareCollection],
    ["an OpenStack cloud's", parseOpenStackCollection],
  ])(
    "%s, of 20 MiB of empty arrays sent as text/plain, is refused 413 and never parsed",
    async (_what: string, parse: unknown) => {
      const req: ExpressRequest = gzipRequest(
        zlib.gzipSync(bomb),
        "text/plain",
      );

      // As StartServer holds the route: a report's limit.
      (
        req as unknown as { requestBodyLimit: RequestBodyLimit }
      ).requestBodyLimit = {
        ...REPORT_REQUEST_BODY_LIMIT,
        values: 1000000,
        objectsArraysAndStrings: 1000000,
      };

      expect(
        await run(GzipRequestBodyMiddleware.parseBody, req),
      ).toBeUndefined();
      expect(Buffer.isBuffer((req as unknown as { body: unknown }).body)).toBe(
        true,
      );

      const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(
        JSON,
        "parse",
      );

      try {
        const error: unknown = await run(
          parse as (
            req: ExpressRequest,
            res: ExpressResponse,
            next: NextFunction,
          ) => void,
          req,
        );

        expect(error).toMatchObject({
          type: "entity.too.many.values",
          status: 413,
          expose: true,
        });
        expect(jsonParse).not.toHaveBeenCalled();
      } finally {
        jsonParse.mockRestore();
      }
    },
    60000,
  );
});
