import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import getRequestBodyLimit, {
  DOCS_REPORT_REQUEST_BODY_LIMIT,
  FILE_REQUEST_BODY_LIMIT,
  INCOMING_REQUEST_ROUTE_PREFIXES,
  LARGE_REQUEST_BODY_LIMIT,
  MCP_OAUTH_REQUEST_BODY_LIMIT,
  ORDINARY_REQUEST_BODY_LIMIT,
  PROBE_INGEST_ROUTE_PREFIXES,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
  SERVER_MONITOR_ROUTE_PREFIXES,
  TELEMETRY_ROUTE_PREFIXES,
  readsBodyAfterAuthentication,
} from "Common/Server/Utils/RequestBodyLimit";
import { TELEMETRY_WRITER_INSERT_ROUTE } from "Common/Server/Utils/Telemetry/TelemetryWriterClient";
import { parseBodyLimit } from "Common/Server/Middleware/RequestBodyParser";
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
import Probe from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import {
  getCollectionParseLimit,
  parseCollectionBody,
  readCollectionBody,
} from "../../FeatureSet/Telemetry/Middleware/ProbeCollectionRequest";
import { ProbeExpressRequest } from "../../FeatureSet/Telemetry/Types/Request";
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
      "Security Events, which the StartServer parsers read",
      [...under(TELEMETRY_ROUTE_PREFIXES, "/security-events/v1/ingest")],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "the batches read once their ingest key is checked (#10702): Fluent, syslog, Pyroscope's push and the rest",
      [
        ...under(TELEMETRY_ROUTE_PREFIXES, "/fluentd/v1/logs"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/syslog/v1/logs"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/kubernetes-cost/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/change-events/v1/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/openlineage/api/v1/lineage"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/dbt/v1/artifacts"),
        ...under(
          TELEMETRY_ROUTE_PREFIXES,
          "/pyroscope/push.v1.PusherService/Push",
        ),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/opamp/v1"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/android-agent/v1/log-sessions"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/fivetran/v1/webhook/id"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/airbyte/v1/webhook/key"),
      ],
      LARGE_REQUEST_BODY_LIMIT,
    ],
    [
      "the uploads read once their ingest key is checked (#10673): a profile, source maps, dSYMs",
      [
        ...under(TELEMETRY_ROUTE_PREFIXES, "/pyroscope/ingest"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/source-maps/v1/upload"),
        ...under(TELEMETRY_ROUTE_PREFIXES, "/dsyms/v1/upload"),
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
      ["FeatureSet/Telemetry/API/DsymIngest.ts", '"/dsyms/v1/upload"'],
      ["FeatureSet/Telemetry/API/Pyroscope.ts", '"/pyroscope/ingest"'],
      ["FeatureSet/MCP/OAuth/OAuthRoutes.ts", '= "/mcp/oauth"'],
      ["FeatureSet/Docs/Index.ts", '"/docs/feedback"'],
      ["FeatureSet/Docs/Index.ts", '"/docs/search/found-nothing"'],
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
            isCompatibleIngestPath(path) ||
            readsBodyAfterAuthentication(path);

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
        "/security-events/v1/ingest",
        "/telemetry/security-events/v1/ingest",
      ]),
    );
    // Read once their key is right (#10702), so not by StartServer.
    expect(checked).not.toContain("/telemetry/fluentd/v1/logs");
    expect(checked).not.toContain("/pyroscope/push.v1.PusherService/Push");
  });

  /*
   * #10702: a telemetry route StartServer leaves the body of unread reads it
   * itself once its key is right - the key check reads it, before the
   * ingestion budget (TelemetryIngest.forSurface's reader), or a reader
   * mounted after it (the uploads). One that read it nowhere would find no
   * body at all, from every client.
   */
  test("every telemetry route whose body StartServer leaves unread reads it once the key is right", () => {
    const telemetryIndex: string = readSource("FeatureSet/Telemetry/Index.ts");
    const read: Array<string> = [];

    // The key check, given the route's reader: it reads between the key and the budget.
    const READS_IN_THE_KEY_CHECK: RegExp =
      /TelemetryIngest\.forSurface\( ?TelemetryIngestSurface\.\w+, \w+,? ?\)/;
    // The key check, then a reader mounted after it: the uploads.
    const READS_AFTER_THE_KEY_CHECK: RegExp =
      /TelemetryIngest\.forSurface\( ?TelemetryIngestSurface\.\w+ ?\), read\w+,/;

    // The routers mounted on the telemetry prefixes, whose key is an ingest key.
    for (const mounted of telemetryIndex.matchAll(
      /app\.use\(TELEMETRY_PREFIXES, (\w+)\);/g,
    )) {
      const imported: RegExpMatchArray | null = telemetryIndex.match(
        new RegExp(`import ${mounted[1]} from "\\./API/([\\w/]+)";`),
      );
      const source: string = readSource(
        `FeatureSet/Telemetry/API/${imported![1]}.ts`,
      ).replace(/\s+/g, " ");

      for (const route of source.matchAll(
        /router\.(?:post|put|patch)\( "([^"]+)",(.*?)async \(/g,
      )) {
        const path: string = route[1]!;
        const chain: string = route[2]!;

        if (
          path.includes("/otlp/v1/") ||
          path.includes("/session-replay/v1/") ||
          isVercelLogDrainPath(path) ||
          isCloudStreamPath(path) ||
          isCompatibleIngestPath(path) ||
          !readsBodyAfterAuthentication(path)
        ) {
          continue;
        }

        expect({
          path,
          readsItsBody:
            READS_IN_THE_KEY_CHECK.test(chain) ||
            READS_AFTER_THE_KEY_CHECK.test(chain),
        }).toEqual({ path, readsItsBody: true });
        read.push(path);
      }
    }

    expect(read).toEqual(
      expect.arrayContaining([
        "/fluentd/v1/logs",
        "/syslog/v1/logs",
        "/kubernetes-cost/ingest",
        "/change-events/v1/ingest",
        "/openlineage/api/v1/lineage",
        "/dbt/v1/artifacts",
        "/android-agent/v1/log-sessions",
        "/opamp/v1",
        "/pyroscope/push.v1.PusherService/Push",
        "/fivetran/v1/webhook/:ingestionKeyId",
        "/airbyte/v1/webhook/:ingestionKey",
        "/pyroscope/ingest",
        "/source-maps/v1/upload",
        "/dsyms/v1/upload",
      ]),
    );
  });

  /*
   * #10672: a route that reads its body with a parser of its own, after
   * StartServer, holds the body to that parser's limit only where
   * StartServer left the body to it - a gzip body, whose bytes it only
   * inflated - unless StartServer holds the route to the same limit. The
   * MCP OAuth endpoints' 64 KB and the docs' 2 KB held for a gzip body
   * alone: an uncompressed one StartServer parsed first, at 1 MB. Every
   * route-level reader with a limit of its own (RequestBodyReadersGuard
   * lists them) is held here to the limit StartServer holds its route to,
   * so a body is held to one limit whatever its encoding.
   */
  test("every route that reads its body with a limit of its own is held to it by StartServer as well", () => {
    const oauthRoutes: string = readSource(
      "FeatureSet/MCP/OAuth/OAuthRoutes.ts",
    );
    const docs: string = readSource("FeatureSet/Docs/Index.ts");
    const mcpRoutes: string = readSource(
      "FeatureSet/MCP/Handlers/RouteHandler.ts",
    );

    // The OAuth endpoints' parsers take their limit from the list.
    expect(oauthRoutes).toContain(
      "const MAX_BODY_BYTES: number = MCP_OAUTH_REQUEST_BODY_LIMIT.bytes;",
    );
    expect(oauthRoutes.match(/limit: MAX_BODY_BYTES/g)).toHaveLength(2);
    expect(oauthRoutes).not.toMatch(/limit: "\d/);

    for (const endpoint of [
      "/mcp/oauth/authorize",
      "/mcp/oauth/token",
      "/mcp/oauth/register",
      "/mcp/oauth/revoke",
      "/mcp/oauth/consent/details",
      "/mcp/oauth/consent/approve",
      "/mcp/oauth/consent/deny",
    ]) {
      expect({ endpoint, limit: getRequestBodyLimit(endpoint) }).toEqual({
        endpoint,
        limit: MCP_OAUTH_REQUEST_BODY_LIMIT,
      });
    }

    // The docs' reports' parser, the same.
    expect(docs).toContain("{ limit: DOCS_REPORT_REQUEST_BODY_LIMIT.bytes }");

    for (const report of ["/docs/feedback", "/docs/search/found-nothing"]) {
      expect({ report, limit: getRequestBodyLimit(report) }).toEqual({
        report,
        limit: DOCS_REPORT_REQUEST_BODY_LIMIT,
      });
    }

    // The MCP endpoint's JSON-RPC parser reads its route's own limit.
    expect(mcpRoutes).toContain(
      "{ limit: getRequestBodyLimit(mcpEndpoint).bytes }",
    );

    // The webhook text readers: their routes' 50 MB, as StartServer's.
    const sizeNamed: (file: string, name: string) => number = (
      file: string,
      name: string,
    ): number => {
      const match: RegExpMatchArray | null = readSource(file).match(
        new RegExp(`export const ${name}: string = "([^"]+)";`),
      );

      expect({ file, name, found: Boolean(match) }).toEqual({
        file,
        name,
        found: true,
      });

      return parseBodyLimit(match![1]!);
    };

    expect(
      sizeNamed(
        "FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
        "TEXT_BODY_LIMIT",
      ),
    ).toBe(getRequestBodyLimit("/incoming-request/key").bytes);
    expect(
      sizeNamed(
        "../Common/Server/Types/Workflow/Components/Webhook.ts",
        "WEBHOOK_TEXT_BODY_LIMIT",
      ),
    ).toBe(getRequestBodyLimit("/workflow/trigger/key").bytes);
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
 * A probe's collection is read by its route, once the route has checked the
 * key in its headers (#10222), as the bytes the gzip reader inflated,
 * whatever its Content-Type said - one that is not JSON's is not counted as
 * it inflates. It is counted before it is parsed, up to a collection's
 * 8,000,000 values. A collection whose probe no header named is read no
 * further than the key at its start until that key is checked (#10260), so
 * a body that opens with anything else is refused unread.
 */
describe("a collection is counted before it is parsed", () => {
  function gzipRequest(
    body: Buffer,
    contentType: string,
    probe?: Probe,
  ): ExpressRequest {
    const stream: PassThrough = new PassThrough();
    const req: ExpressRequest = stream as unknown as ExpressRequest;

    (req as unknown as { headers: Record<string, string> }).headers = {
      "content-encoding": "gzip",
      "content-type": contentType,
      "content-length": String(body.length),
    };

    if (probe) {
      (req as ProbeExpressRequest).probe = probe;
    }

    setImmediate(() => {
      stream.end(body);
    });

    return req;
  }

  // An answer, as Response.sendErrorResponse writes one.
  interface Answered {
    status?: number;
    body?: unknown;
  }

  function run(
    middleware: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => void,
    req: ExpressRequest,
    answered: Answered = {},
  ): Promise<unknown> {
    return new Promise<unknown>((resolve: (value: unknown) => void) => {
      const res: Record<string, unknown> = {
        headersSent: false,
        shouldKeepAlive: true,
        status: (status: number): unknown => {
          answered.status = status;
          return res;
        },
        send: (body: unknown): unknown => {
          answered.body = body;
          resolve("answered");
          return res;
        },
      };

      middleware(
        req,
        res as unknown as ExpressResponse,
        ((error?: unknown) => {
          resolve(error);
        }) as NextFunction,
      );
    });
  }

  test("of 26 MiB of empty arrays sent as text/plain by a probe its headers named, is refused 413 at a collection's 8,000,000 values and never parsed", async () => {
    const bomb: Buffer = Buffer.from(
      `[${"[],".repeat(Math.floor((26 * 1024 * 1024) / 3))}[]]`,
    );
    const req: ExpressRequest = gzipRequest(
      zlib.gzipSync(bomb),
      "text/plain",
      new Probe(new ObjectID("11111111-1111-4111-8111-111111111111")),
    );

    // The route's own reader: not JSON's type, so not counted as it inflates.
    expect(await run(readCollectionBody, req)).toBeUndefined();
    expect(Buffer.isBuffer((req as unknown as { body: unknown }).body)).toBe(
      true,
    );

    const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    try {
      const error: unknown = await run(
        parseCollectionBody as (
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
        limit: REPORT_REQUEST_BODY_LIMIT.values,
      });
      expect(jsonParse).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  }, 120000);

  test("of 20 MiB of empty arrays whose probe no header named, is refused at its opening, read no further and never parsed", async () => {
    const bomb: Buffer = Buffer.from(
      `[${"[],".repeat(Math.floor((20 * 1024 * 1024) / 3))}[]]`,
    );
    const req: ExpressRequest = gzipRequest(zlib.gzipSync(bomb), "text/plain");
    const answered: Answered = {};
    const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    try {
      expect(await run(readCollectionBody, req, answered)).toBe("answered");
      expect(answered).toEqual({
        status: 400,
        body: { message: "ProbeId or ProbeKey is missing" },
      });
      expect((req as unknown as { body: unknown }).body).toBeUndefined();
      expect(jsonParse).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  }, 60000);

  test("is held to a collection's 8,000,000 values once its probe is known, and to a large route's 1,000,000 until then", () => {
    const unknown: ProbeExpressRequest = {} as ProbeExpressRequest;
    const known: ProbeExpressRequest = {
      probe: new Probe(new ObjectID("11111111-1111-4111-8111-111111111111")),
    } as ProbeExpressRequest;

    expect(getCollectionParseLimit(unknown)).toBe(LARGE_REQUEST_BODY_LIMIT);
    expect(getCollectionParseLimit(known)).toBe(REPORT_REQUEST_BODY_LIMIT);
    expect(REPORT_REQUEST_BODY_LIMIT.values).toBe(8000000);
    expect(LARGE_REQUEST_BODY_LIMIT.values).toBe(1000000);
  });
});
