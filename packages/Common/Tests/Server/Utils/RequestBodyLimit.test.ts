import getRequestBodyLimit, {
  FILE_REQUEST_BODY_LIMIT,
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_LIMIT,
  LARGE_REQUEST_BODY_ROUTES,
  LargeRequestBodyRoute,
  ORDINARY_REQUEST_BODY_LIMIT,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
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
    const specific: LargeRequestBodyRoute | undefined =
      LARGE_REQUEST_BODY_ROUTES.find((route: LargeRequestBodyRoute) => {
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

  test("keep the defaults for a value that is not a whole positive number", () => {
    expect(
      loadWith({
        REQUEST_BODY_MAX_BYTES: "1mb",
        REQUEST_BODY_MAX_JSON_VALUES: "-5",
      }),
    ).toEqual(ORDINARY_REQUEST_BODY_LIMIT);
  });
});
