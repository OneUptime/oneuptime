import getRequestBodyLimit, {
  DOCS_REPORT_REQUEST_BODY_LIMIT,
  FILE_REQUEST_BODY_LIMIT,
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_LIMIT,
  LARGE_REQUEST_BODY_ROUTES,
  MCP_OAUTH_REQUEST_BODY_LIMIT,
  OPAMP_MESSAGE_MAX_BYTES,
  OPAMP_REQUEST_BODY_LIMIT,
  ORDINARY_REQUEST_BODY_LIMIT,
  PROBE_INGEST_ROUTE_PREFIXES,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
  RequestBodyRoute,
  SMALL_REQUEST_BODY_ROUTES,
  TELEMETRY_ROUTE_PREFIXES,
  readsBodyAfterAuthentication,
} from "../../../Server/Utils/RequestBodyLimit";
import { COMPATIBLE_JSON_MAX_VALUES } from "../../../Types/Telemetry/CompatibleIngest";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHICH LIMIT A REQUEST'S BODY IS HELD TO, BY ITS PATH (#10183).
 *
 * StartServer reads a body before routing, so the limit is chosen from the
 * path as the App's routers will match it: in any case, with or without a
 * trailing slash, under each prefix a router is mounted on. A path nothing
 * lists - one no route answers among them - takes the ordinary limit.
 */

const MIB: number = 1024 * 1024;

describe("the ordinary limit", () => {
  test("is 1 MiB and 100,000 values, both counts alike", () => {
    expect(ORDINARY_REQUEST_BODY_LIMIT).toEqual({
      bytes: MIB,
      values: 100000,
      objectsArraysAndStrings: 100000,
    });
  });

  test.each([
    "/api/monitor",
    "/api/monitor/get-list",
    "/api/incident/0b5b3b9e-1e8f-4c3a-9a9e-0b5b3b9e1e8f",
    "/api/identity/login",
    "/login",
    "/api/telemetry/logs/histogram",
    "/api/status-page/overview/0b5b3b9e-1e8f-4c3a-9a9e-0b5b3b9e1e8f",
    "/api/file-anything",
    "/api/filex",
    "/probe-ingestx/probe/response/ingest",
    "/mcp",
    "/nothing/answers/this",
    "/",
    "",
  ])("%s is ordinary", (path: string) => {
    expect(getRequestBodyLimit(path)).toBe(ORDINARY_REQUEST_BODY_LIMIT);
  });
});

describe("the large routes", () => {
  test.each([
    // A file the Dashboard uploads (nginx sends /file to /api/file).
    ["/api/file", FILE_REQUEST_BODY_LIMIT],
    // A probe's report, under every prefix the probe routers are mounted on.
    ["/probe-ingest/probe/response/ingest", LARGE_REQUEST_BODY_LIMIT],
    ["/ingestor/probe/response/ingest", LARGE_REQUEST_BODY_LIMIT],
    ["/probe/response/ingest", LARGE_REQUEST_BODY_LIMIT],
    ["/probe-ingest/monitor/list", LARGE_REQUEST_BODY_LIMIT],
    ["/probe-ingest/probe/vmware/collection", REPORT_REQUEST_BODY_LIMIT],
    ["/ingestor/probe/vmware/collection", REPORT_REQUEST_BODY_LIMIT],
    ["/probe/vmware/collection", REPORT_REQUEST_BODY_LIMIT],
    ["/probe/openstack/collection", REPORT_REQUEST_BODY_LIMIT],
    ["/telemetry-writer/insert", REPORT_REQUEST_BODY_LIMIT],
    ["/incoming-email/sendgrid/secret", LARGE_REQUEST_BODY_LIMIT],
    ["/server-monitor/response/ingest/key", LARGE_REQUEST_BODY_LIMIT],
    [
      "/server-monitor-ingest/server-monitor/response/ingest/key",
      LARGE_REQUEST_BODY_LIMIT,
    ],
    ["/incoming-request/key", LARGE_REQUEST_BODY_LIMIT],
    ["/incoming-request-ingest/incoming-request/key", LARGE_REQUEST_BODY_LIMIT],
    ["/fluentd/v1/logs", LARGE_REQUEST_BODY_LIMIT],
    ["/telemetry/fluentd/v1/logs", LARGE_REQUEST_BODY_LIMIT],
    ["/telemetry/dbt/v1/artifacts", LARGE_REQUEST_BODY_LIMIT],
    ["/syslog/v1/logs", LARGE_REQUEST_BODY_LIMIT],
    // Pyroscope's push.v1 protobuf, read once its key is right (#10702).
    ["/pyroscope/push.v1.PusherService/Push", LARGE_REQUEST_BODY_LIMIT],
    [
      "/telemetry/pyroscope/push.v1.PusherService/Push",
      LARGE_REQUEST_BODY_LIMIT,
    ],
    ["/workflow/manual/run/id", LARGE_REQUEST_BODY_LIMIT],
    ["/api/huntress/webhook/key", LARGE_REQUEST_BODY_LIMIT],
    ["/runner-ingest/job/id/result", LARGE_REQUEST_BODY_LIMIT],
    ["/api/ai-agent-data/llm-completion", LARGE_REQUEST_BODY_LIMIT],
    ["/api/notification/email/send", LARGE_REQUEST_BODY_LIMIT],
    ["/api/form/public/share-key/submit", LARGE_REQUEST_BODY_LIMIT],
    ["/api/form/custom-domain/submit", LARGE_REQUEST_BODY_LIMIT],
    ["/api/tool-import/upload", LARGE_REQUEST_BODY_LIMIT],
    ["/api/security-watchlist/import", LARGE_REQUEST_BODY_LIMIT],
    ["/api/incident-video-call/id/transcript", LARGE_REQUEST_BODY_LIMIT],
    ["/api/status-page", LARGE_REQUEST_BODY_LIMIT],
    ["/api/status-page/id", LARGE_REQUEST_BODY_LIMIT],
    ["/api/status-page/id/update-item", LARGE_REQUEST_BODY_LIMIT],
    ["/api/dashboard/id", LARGE_REQUEST_BODY_LIMIT],
    ["/api/identity/scim/v2/id/Groups/group", LARGE_REQUEST_BODY_LIMIT],
    ["/scim/v2/id/Bulk", LARGE_REQUEST_BODY_LIMIT],
    ["/api/github/webhook", LARGE_REQUEST_BODY_LIMIT],
    ["/api/billing/webhook", LARGE_REQUEST_BODY_LIMIT],
  ])("%s", (path: string, limit: RequestBodyLimit) => {
    expect(getRequestBodyLimit(path)).toBe(limit);
  });

  test("are matched as the routers match: in any case, with a trailing slash or not", () => {
    for (const path of [
      "/API/File",
      "/api/file/",
      "/Probe-Ingest/Probe/VMware/Collection/",
      "/TELEMETRY-WRITER/insert",
    ]) {
      expect(getRequestBodyLimit(path)).not.toBe(ORDINARY_REQUEST_BODY_LIMIT);
    }

    expect(getRequestBodyLimit("/API/File")).toBe(FILE_REQUEST_BODY_LIMIT);
  });

  test("a parameter stands for one segment, no more and no fewer", () => {
    expect(getRequestBodyLimit("/api/status-page/a/b")).toBe(
      ORDINARY_REQUEST_BODY_LIMIT,
    );
    expect(getRequestBodyLimit("/api/form/public/submit")).toBe(
      ORDINARY_REQUEST_BODY_LIMIT,
    );
    expect(getRequestBodyLimit("/api/form/public/key/submit/again")).toBe(
      ORDINARY_REQUEST_BODY_LIMIT,
    );
  });

  test("a file's numbers are held only by its size, its objects, arrays and strings as on any large route", () => {
    expect(FILE_REQUEST_BODY_LIMIT.bytes).toBe(LARGE_REQUEST_BODY_BYTES);
    // As many numbers as the text can hold: one a two bytes, "0,".
    expect(FILE_REQUEST_BODY_LIMIT.values).toBe(LARGE_REQUEST_BODY_BYTES / 2);
    expect(FILE_REQUEST_BODY_LIMIT.objectsArraysAndStrings).toBe(
      LARGE_REQUEST_BODY_LIMIT.objectsArraysAndStrings,
    );
  });

  test("the large routes' JSON limit is the compatible endpoints'", () => {
    expect(LARGE_REQUEST_BODY_LIMIT.values).toBe(COMPATIBLE_JSON_MAX_VALUES);
    expect(LARGE_REQUEST_BODY_LIMIT.bytes).toBe(50 * MIB);
  });

  test("every listed route says why, takes no more than 50 MiB, and none is listed twice", () => {
    const seen: Set<string> = new Set();

    for (const route of LARGE_REQUEST_BODY_ROUTES) {
      expect(route.reason.length).toBeGreaterThan(40);
      expect(route.reason.endsWith(".")).toBe(true);
      expect(route.limit.bytes).toBeLessThanOrEqual(50 * MIB);
      expect(route.limit.bytes).toBeGreaterThan(
        ORDINARY_REQUEST_BODY_LIMIT.bytes,
      );
      expect(route.limit.objectsArraysAndStrings).toBeLessThanOrEqual(
        route.limit.values,
      );

      for (const path of route.paths) {
        const key: string = path.toLowerCase();

        expect({ path, isListedTwice: seen.has(key) }).toEqual({
          path,
          isListedTwice: false,
        });
        seen.add(key);
        expect(path.startsWith("/")).toBe(true);
        expect(path.includes("//")).toBe(false);
      }
    }
  });

  test("each route's limit is the one its most specific path gives", () => {
    const specific: RequestBodyRoute | undefined =
      LARGE_REQUEST_BODY_ROUTES.find((route: RequestBodyRoute) => {
        return route.paths.includes("/probe/vmware/collection");
      });

    expect(specific?.limit).toBe(REPORT_REQUEST_BODY_LIMIT);
    // /probe/* is listed as well, with a smaller limit; the exact path wins.
    expect(getRequestBodyLimit("/probe/vmware/collection")).toBe(
      REPORT_REQUEST_BODY_LIMIT,
    );
    expect(getRequestBodyLimit("/probe/vmware/work")).toBe(
      LARGE_REQUEST_BODY_LIMIT,
    );
  });
});

/*
 * THE ROUTES THAT READ THEIR BODY ONLY ONCE THEY KNOW WHO SENT IT (#10222).
 *
 * Eight million JSON values cost JSON.parse 1.4 s and 490 MiB of heap, and
 * StartServer reads a body before routing, before any key is checked. So
 * the routes that take that many read the body themselves and check their
 * caller's key before they parse it: StartServer leaves it unread. Matched as
 * the limit is, so a path the router answers can never be parsed by
 * StartServer.
 */
describe("the routes that parse their body only after their caller's key is checked", () => {
  const collections: Array<string> = PROBE_INGEST_ROUTE_PREFIXES.flatMap(
    (prefix: string): Array<string> => {
      return [
        `${prefix}/probe/vmware/collection`,
        `${prefix}/probe/openstack/collection`,
      ];
    },
  );

  const uploads: Array<string> = TELEMETRY_ROUTE_PREFIXES.flatMap(
    (prefix: string): Array<string> => {
      return [
        `${prefix}/pyroscope/ingest`,
        `${prefix}/source-maps/v1/upload`,
        `${prefix}/dsyms/v1/upload`,
      ];
    },
  );

  const batches: Array<string> = TELEMETRY_ROUTE_PREFIXES.flatMap(
    (prefix: string): Array<string> => {
      return [
        `${prefix}/fluentd/v1/logs`,
        `${prefix}/syslog/v1/logs`,
        `${prefix}/kubernetes-cost/ingest`,
        `${prefix}/change-events/v1/ingest`,
        `${prefix}/openlineage/api/v1/lineage`,
        `${prefix}/dbt/v1/artifacts`,
        `${prefix}/android-agent/v1/log-sessions`,
        `${prefix}/pyroscope/push.v1.PusherService/Push`,
        `${prefix}/fivetran/v1/webhook/:ingestionKeyId`,
        `${prefix}/airbyte/v1/webhook/:ingestionKey`,
      ];
    },
  );

  test("are a probe's collections, under every prefix, and a forwarding pod's rows", () => {
    expect(collections).toHaveLength(6);

    for (const path of [...collections, "/telemetry-writer/insert"]) {
      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: true });
      // What they take once the key is right.
      expect(getRequestBodyLimit(path)).toBe(REPORT_REQUEST_BODY_LIMIT);
    }
  });

  /*
   * #10673: a Pyroscope SDK's profile, source maps from CI and an iOS app's
   * dSYMs were read before their ingest key was checked - multipart parsed,
   * gzip inflated, JSON parsed - for anyone. Each client sends its key in a
   * header, so the body is read once the key is right, held to a large
   * route's 50 MB.
   */
  test("are the uploads too, under both telemetry prefixes, each held to a large route's limit", () => {
    expect(uploads).toHaveLength(6);

    for (const path of uploads) {
      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: true });
      expect(getRequestBodyLimit(path)).toBe(LARGE_REQUEST_BODY_LIMIT);
    }
  });

  /*
   * #10702: the batches collectors, agents and CI send - Fluent Bit and
   * Fluentd, syslog, Pyroscope's push, Kubernetes cost, change events,
   * OpenLineage, dbt, the Android agent, Fivetran and Airbyte - were read
   * before their key was checked: JSON parsed, gzip inflated, for anyone.
   * Each client sends its key in a header or the URL, so the body is read
   * once the key is right, held to a large route's 50 MB.
   */
  test("are the batches collectors, agents and CI send, under both telemetry prefixes, each held to a large route's limit", () => {
    expect(batches).toHaveLength(20);

    for (const path of batches) {
      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: true });
      expect(getRequestBodyLimit(path)).toBe(LARGE_REQUEST_BODY_LIMIT);
    }
  });

  /*
   * #10770: OpAMP's host messages were read once their key was right too,
   * but held to a large route's 50 MB, while the handler refused anything
   * over an OpAMP message's 1 MiB: a key holder could have 50 MB read, or
   * inflated, for a request refused at 1 MiB. They are held to the 1 MiB.
   */
  test("are OpAMP's host messages, under both telemetry prefixes, held to an OpAMP message's own 1 MiB", () => {
    for (const prefix of TELEMETRY_ROUTE_PREFIXES) {
      for (const path of [
        `${prefix}/opamp/v1`,
        `${prefix}/opamp/v1/`,
        `${prefix}/OpAMP/V1`,
      ]) {
        expect({
          path,
          afterAuthentication: readsBodyAfterAuthentication(path),
          limit: getRequestBodyLimit(path),
        }).toEqual({
          path,
          afterAuthentication: true,
          limit: OPAMP_REQUEST_BODY_LIMIT,
        });
      }
    }

    expect(OPAMP_MESSAGE_MAX_BYTES).toBe(MIB);
    // Held by its size alone: protobuf has no JSON values to count.
    expect(OPAMP_REQUEST_BODY_LIMIT).toEqual({
      bytes: MIB,
      values: MIB / 2,
      objectsArraysAndStrings: MIB / 2,
    });
    // Only the route itself: what lies under it, or beside it, is not it.
    for (const path of ["/opamp/v1/extra", "/opamp", "/telemetry/opamp/v2"]) {
      expect({ path, limit: getRequestBodyLimit(path) }).toEqual({
        path,
        limit: ORDINARY_REQUEST_BODY_LIMIT,
      });
    }
  });

  test("leave Security Events as it is: read by StartServer before routing, held to a large route's limit", () => {
    for (const prefix of TELEMETRY_ROUTE_PREFIXES) {
      const path: string = `${prefix}/security-events/v1/ingest`;

      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: false });
      expect(getRequestBodyLimit(path)).toBe(LARGE_REQUEST_BODY_LIMIT);
    }
  });

  test("are matched as the routers match: in any case, with a trailing slash or not", () => {
    for (const path of [
      "/Fluentd/V1/Logs/",
      "/TELEMETRY/SYSLOG/V1/LOGS",
      "/telemetry/pyroscope/push.v1.pusherservice/push",
      "/Airbyte/V1/Webhook/a-key/",
      "/Probe-Ingest/Probe/VMware/Collection",
      "/probe-ingest/probe/vmware/collection/",
      "/INGESTOR/PROBE/OPENSTACK/COLLECTION/",
      "/Probe/OpenStack/Collection",
      "/Telemetry-Writer/Insert/",
      "/Pyroscope/Ingest/",
      "/TELEMETRY/SOURCE-MAPS/V1/UPLOAD",
      "/telemetry/dsyms/v1/upload/",
    ]) {
      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: true });
    }
  });

  test("are the only ones: every other route, a probe's other routes among them, is read by StartServer", () => {
    for (const path of [
      "/probe-ingest/probe/vmware/work",
      "/probe-ingest/probe/vmware/test",
      "/probe/openstack/work",
      "/probe-ingest/probe/response/ingest",
      "/probe-ingest/alive",
      "/probe-ingest/probe/vmware/collection/extra",
      "/telemetry-writer/insert/extra",
      "/telemetry-writer",
      "/api/file",
      "/api/monitor/get-list",
      "/fluentd/v1/logs/extra",
      "/syslog/v1",
      "/security-events/v1/ingest",
      "/telemetry/security-events/v1/ingest",
      "/fivetran/v1/webhook",
      "/pyroscope/push.v1.PusherService/Push/extra",
      "/pyroscope/ingest/extra",
      "/source-maps/v1",
      "/dsyms",
      "/",
      "",
    ]) {
      expect({
        path,
        afterAuthentication: readsBodyAfterAuthentication(path),
      }).toEqual({ path, afterAuthentication: false });
    }

    const listed: Array<RequestBodyRoute> = LARGE_REQUEST_BODY_ROUTES.filter(
      (route: RequestBodyRoute): boolean => {
        return Boolean(route.readsBodyAfterAuthentication);
      },
    );

    expect(
      listed.flatMap((route: RequestBodyRoute): ReadonlyArray<string> => {
        return route.paths;
      }),
    ).toEqual([
      ...uploads,
      ...batches,
      ...collections,
      "/telemetry-writer/insert",
    ]);

    // Each says why, and how its caller is known first.
    for (const route of listed) {
      expect([REPORT_REQUEST_BODY_LIMIT, LARGE_REQUEST_BODY_LIMIT]).toContain(
        route.limit,
      );
      expect(route.reason).toMatch(/key/);
    }

    /*
     * Of the routes that take no more than an ordinary one, OpAMP's alone
     * reads its body late: its key is checked first, as the batches' are.
     */
    const smallAndLate: Array<RequestBodyRoute> =
      SMALL_REQUEST_BODY_ROUTES.filter((route: RequestBodyRoute): boolean => {
        return Boolean(route.readsBodyAfterAuthentication);
      });

    expect(
      smallAndLate.flatMap((route: RequestBodyRoute): ReadonlyArray<string> => {
        return route.paths;
      }),
    ).toEqual(
      TELEMETRY_ROUTE_PREFIXES.map((prefix: string): string => {
        return `${prefix}/opamp/v1`;
      }),
    );
    expect(smallAndLate[0]!.limit).toBe(OPAMP_REQUEST_BODY_LIMIT);
    expect(smallAndLate[0]!.reason).toMatch(/key/);
  });
});

/*
 * THE ROUTES THAT TAKE LESS THAN AN ORDINARY ONE (#10672). The MCP OAuth
 * endpoints and the docs' reports held only a gzip body to their own limits:
 * StartServer parsed an uncompressed one first, at the ordinary 1 MB. Listed
 * here, StartServer holds every body there to the route's own limit before
 * routing, whatever its encoding.
 */
describe("the routes that take less than an ordinary one", () => {
  test.each([
    ["/mcp/oauth/token", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/revoke", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/register", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/authorize", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/consent/details", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/consent/approve", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/mcp/oauth/consent/deny", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/MCP/OAuth/Token/", MCP_OAUTH_REQUEST_BODY_LIMIT],
    ["/docs/feedback", DOCS_REPORT_REQUEST_BODY_LIMIT],
    ["/docs/search/found-nothing", DOCS_REPORT_REQUEST_BODY_LIMIT],
    ["/Docs/Feedback/", DOCS_REPORT_REQUEST_BODY_LIMIT],
  ])("%s", (path: string, limit: RequestBodyLimit) => {
    expect(getRequestBodyLimit(path)).toBe(limit);
    // Read by StartServer, as before: only held to less.
    expect(readsBodyAfterAuthentication(path)).toBe(false);
  });

  test("are their own routes alone: the MCP endpoint and the docs' pages stay ordinary", () => {
    for (const path of [
      "/mcp",
      "/mcp/",
      "/mcp/tools",
      "/mcp/oauthx/token",
      "/docs",
      "/docs/en/introduction/getting-started",
      "/docs/search",
      "/docs/feedback/more",
      "/docs/search/found-nothing/more",
    ]) {
      expect({ path, limit: getRequestBodyLimit(path) }).toEqual({
        path,
        limit: ORDINARY_REQUEST_BODY_LIMIT,
      });
    }
  });

  test("are 64 KB and 2 KB, as the routes' own parsers held a gzip body, and held by their size alone", () => {
    expect(MCP_OAUTH_REQUEST_BODY_LIMIT.bytes).toBe(64 * 1024);
    expect(DOCS_REPORT_REQUEST_BODY_LIMIT.bytes).toBe(2 * 1024);

    for (const limit of [
      MCP_OAUTH_REQUEST_BODY_LIMIT,
      DOCS_REPORT_REQUEST_BODY_LIMIT,
    ]) {
      // As many values as the bytes can hold, "0,": counting refuses none.
      expect(limit.values).toBe(limit.bytes / 2);
      expect(limit.objectsArraysAndStrings).toBe(limit.bytes / 2);
    }
  });

  test("every one says why, takes no more than an ordinary route, and none is listed twice, or as a large one", () => {
    const large: Set<string> = new Set(
      LARGE_REQUEST_BODY_ROUTES.flatMap(
        (route: RequestBodyRoute): ReadonlyArray<string> => {
          return route.paths;
        },
      ).map((path: string): string => {
        return path.toLowerCase();
      }),
    );
    const seen: Set<string> = new Set();

    expect(SMALL_REQUEST_BODY_ROUTES.length).toBeGreaterThanOrEqual(2);

    for (const route of SMALL_REQUEST_BODY_ROUTES) {
      expect(route.reason.length).toBeGreaterThan(40);
      expect(route.reason.endsWith(".")).toBe(true);
      // The ordinary route's own 1 MiB, which REQUEST_BODY_MAX_BYTES can raise.
      expect(route.limit.bytes).toBeLessThanOrEqual(MIB);
      expect(route.limit.objectsArraysAndStrings).toBeLessThanOrEqual(
        route.limit.values,
      );

      for (const path of route.paths) {
        const key: string = path.toLowerCase();

        expect({
          path,
          isListedTwice: seen.has(key) || large.has(key),
        }).toEqual({
          path,
          isListedTwice: false,
        });
        seen.add(key);
        expect(path.startsWith("/")).toBe(true);
      }
    }
  });
});

/*
 * A self-hosted server can raise the ordinary limits for a client of its
 * own (REQUEST_BODY_MAX_BYTES, REQUEST_BODY_MAX_JSON_VALUES), up to what a
 * large route takes and no further.
 */
describe("the ordinary limits a self-hosted server sets", () => {
  const loadWith: (env: Record<string, string>) => RequestBodyLimit = (
    env: Record<string, string>,
  ): RequestBodyLimit => {
    const saved: NodeJS.ProcessEnv = { ...process.env };
    let limit: RequestBodyLimit | null = null;

    Object.assign(process.env, env);

    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        limit = require("../../../Server/Utils/RequestBodyLimit")
          .ORDINARY_REQUEST_BODY_LIMIT as RequestBodyLimit;
      });
    } finally {
      process.env = saved;
    }

    return limit!;
  };

  test("are read from the environment", () => {
    expect(
      loadWith({
        REQUEST_BODY_MAX_BYTES: String(5 * MIB),
        REQUEST_BODY_MAX_JSON_VALUES: "250000",
      }),
    ).toEqual({
      bytes: 5 * MIB,
      values: 250000,
      objectsArraysAndStrings: 250000,
    });
  });

  test("are clamped to a large route's", () => {
    expect(
      loadWith({
        REQUEST_BODY_MAX_BYTES: String(500 * MIB),
        REQUEST_BODY_MAX_JSON_VALUES: "90000000",
      }),
    ).toEqual({
      bytes: 50 * MIB,
      values: 1000000,
      objectsArraysAndStrings: 1000000,
    });
  });

  test("raise no route's own limit: the MCP OAuth endpoints, the docs' reports and OpAMP keep theirs", () => {
    const saved: NodeJS.ProcessEnv = { ...process.env };
    const limits: Record<string, RequestBodyLimit> = {};

    Object.assign(process.env, {
      REQUEST_BODY_MAX_BYTES: String(40 * MIB),
      REQUEST_BODY_MAX_JSON_VALUES: "900000",
    });

    try {
      jest.isolateModules(() => {
        const reloaded: {
          getRequestBodyLimit: (path: string) => RequestBodyLimit;
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        } = require("../../../Server/Utils/RequestBodyLimit");

        for (const path of [
          "/api/monitor",
          "/mcp/oauth/token",
          "/docs/feedback",
          "/telemetry/opamp/v1",
        ]) {
          limits[path] = reloaded.getRequestBodyLimit(path);
        }
      });
    } finally {
      process.env = saved;
    }

    expect(limits["/api/monitor"]!.bytes).toBe(40 * MIB);
    expect(limits["/mcp/oauth/token"]).toEqual(MCP_OAUTH_REQUEST_BODY_LIMIT);
    expect(limits["/docs/feedback"]).toEqual(DOCS_REPORT_REQUEST_BODY_LIMIT);
    expect(limits["/telemetry/opamp/v1"]).toEqual(OPAMP_REQUEST_BODY_LIMIT);
  });

  test("keep the defaults for a value that is not a whole positive number", () => {
    expect(
      loadWith({
        REQUEST_BODY_MAX_BYTES: "1mb",
        REQUEST_BODY_MAX_JSON_VALUES: "-5",
      }),
    ).toEqual(ORDINARY_REQUEST_BODY_LIMIT);
  });
});
