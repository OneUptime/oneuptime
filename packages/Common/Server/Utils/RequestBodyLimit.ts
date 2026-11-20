import {
  RequestBodyMaxBytes,
  RequestBodyMaxJsonValues,
} from "../EnvironmentConfig";
import { JsonElementLimits } from "../../Utils/JsonElementCount";

/*
 * HOW MUCH BODY A REQUEST MAY BRING, BY THE ROUTE IT IS FOR (#10183).
 *
 * StartServer reads every request's body before routing, and so before
 * anyone is signed in: whatever a route allows, it allows to anyone. Every
 * route used to take 50 MiB of JSON and parse it whole. 50 MiB of "[],"
 * parses into 17 million empty arrays - three seconds of blocked event loop
 * and 667 MiB of heap, measured on Node 26 - and it gzips to 50 KB.
 *
 * Now a body is held to two things before it is parsed:
 *
 *   - its size, as sent and once inflated (`bytes`);
 *   - how many values its JSON holds, counted over its bytes before
 *     JSON.parse sees them (JsonElementTally) - every value, and the
 *     objects, arrays and strings among them, which JSON.parse makes an
 *     object of its own for.
 *
 * Almost every route takes ORDINARY_REQUEST_BODY_LIMIT: what the Dashboard,
 * the API, the CLI and Terraform send is a record, a query or a few ids.
 * The largest dashboard template is 13 KB and 1,056 values, the largest
 * workflow template 43 KB and 250 (measured), against 1 MiB and 100,000.
 * The routes that take more are listed below, each with why, and match as
 * the App's routers do: in any case, with or without a trailing slash,
 * under every prefix their router is mounted on. A path that is not listed,
 * one no route answers included, is ordinary.
 *
 * A self-hosted server can raise the ordinary limits with
 * REQUEST_BODY_MAX_BYTES and REQUEST_BODY_MAX_JSON_VALUES (EnvironmentConfig),
 * for a client that sends more to a route not listed here.
 */

export interface RequestBodyLimit extends JsonElementLimits {
  // The most bytes the body may be: as sent, and once a gzip body inflates.
  bytes: number;
}

const MIB: number = 1024 * 1024;

// What the App has always taken, and its ingress (nginx) takes on /api.
export const LARGE_REQUEST_BODY_BYTES: number = 50 * MIB;

/*
 * The JSON values a large body may hold: the limit the compatible endpoints
 * hold their JSON to (COMPATIBLE_JSON_MAX_VALUES). Counted, a body of a
 * million empty objects is refused after its first 3 MiB, in milliseconds;
 * a million values parse in about a tenth of a second.
 */
export const LARGE_REQUEST_BODY_JSON_VALUES: number = 1000000;

export const ORDINARY_REQUEST_BODY_LIMIT: RequestBodyLimit = {
  bytes: RequestBodyMaxBytes,
  values: RequestBodyMaxJsonValues,
  objectsArraysAndStrings: RequestBodyMaxJsonValues,
};

export const LARGE_REQUEST_BODY_LIMIT: RequestBodyLimit = {
  bytes: LARGE_REQUEST_BODY_BYTES,
  values: LARGE_REQUEST_BODY_JSON_VALUES,
  objectsArraysAndStrings: LARGE_REQUEST_BODY_JSON_VALUES,
};

/*
 * A file the Dashboard uploads travels as JSON, one number for each of its
 * bytes (a Buffer's JSON): a 10 MB file is 36 MB of JSON and 10.5 million
 * numbers. Numbers cost JSON.parse a slot in their array and nothing more
 * (50 MiB of a file's numbers parse in a quarter of a second), so they are
 * held only by the size: one number takes at least two bytes. Objects,
 * arrays and strings are held as on any large route.
 */
export const FILE_REQUEST_BODY_LIMIT: RequestBodyLimit = {
  bytes: LARGE_REQUEST_BODY_BYTES,
  values: Math.ceil(LARGE_REQUEST_BODY_BYTES / 2),
  objectsArraysAndStrings: LARGE_REQUEST_BODY_JSON_VALUES,
};

/*
 * A probe's collection of a large vCenter or OpenStack cloud is up to
 * 48 MiB of OTLP metrics (VMWARE_COLLECTION_MAX_PAYLOAD_BYTES,
 * OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES), about 8 bytes a value: some six
 * million values. A forwarding pod's ClickHouse rows are up to 30 MB a
 * request (TELEMETRY_WRITER_MAX_BODY_BYTES), about 13 bytes a value.
 *
 * Eight million values take JSON.parse about 1.4 s and 490 MiB of heap
 * (Node 26), so only a caller whose key was checked first is held to this
 * (#10222): the routes that take it read their bodies themselves, after
 * that (readsBodyAfterAuthentication).
 */
export const REPORT_REQUEST_BODY_LIMIT: RequestBodyLimit = {
  bytes: LARGE_REQUEST_BODY_BYTES,
  values: 8000000,
  objectsArraysAndStrings: 8000000,
};

export interface LargeRequestBodyRoute {
  /*
   * The paths, as the App receives them: "/" between segments, a ":name"
   * segment for any one segment, and a last segment "*" for the path and
   * everything under it.
   */
  paths: ReadonlyArray<string>;
  limit: RequestBodyLimit;
  /*
   * Set for a route that checks its caller's key before it reads the body
   * (#10222): StartServer leaves the body unread, and the route reads it,
   * held to `limit`, once it knows who sent it
   * (Middleware/RequestBodyAfterAuthentication).
   */
  readsBodyAfterAuthentication?: boolean;
  // Why this route takes more than an ordinary one.
  reason: string;
}

/*
 * The prefixes the App mounts its routers under (App/FeatureSet/*\/Index.ts),
 * "" for the root. App/Tests/Utils/RequestBodyLimitRoutes.test.ts reads them
 * there, so a prefix added to a router is added here too.
 */
export const TELEMETRY_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/telemetry",
  "",
];
export const PROBE_INGEST_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/probe-ingest",
  "/ingestor",
  "",
];
export const SERVER_MONITOR_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/server-monitor-ingest",
  "",
];
export const INCOMING_REQUEST_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/incoming-request-ingest",
  "",
];
export const IDENTITY_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/api/identity",
  "",
];

const under: (
  prefixes: ReadonlyArray<string>,
  paths: ReadonlyArray<string>,
) => Array<string> = (
  prefixes: ReadonlyArray<string>,
  paths: ReadonlyArray<string>,
): Array<string> => {
  return prefixes.flatMap((prefix: string): Array<string> => {
    return paths.map((path: string): string => {
      return `${prefix}${path}`;
    });
  });
};

// A model's create and update, as BaseAPI answers them under /api.
const createAndUpdate: (crudPath: string) => Array<string> = (
  crudPath: string,
): Array<string> => {
  return [
    `/api${crudPath}`,
    `/api${crudPath}/:id`,
    `/api${crudPath}/:id/update-item`,
  ];
};

/*
 * The telemetry routes StartServer reads the body of: the rest of the
 * telemetry router (OTLP, session replay, the compatible endpoints, the
 * Vercel log drain, the cloud streams) reads its own.
 */
const TELEMETRY_INGEST_PATHS: ReadonlyArray<string> = [
  "/fluentd/*",
  "/syslog/*",
  "/kubernetes-cost/*",
  "/security-events/*",
  "/change-events/*",
  "/openlineage/*",
  "/dbt/*",
  "/android-agent/*",
  "/opamp/*",
  "/pyroscope/*",
  "/source-maps/*",
  // An iOS app's symbol tables, as JSON from the CLI: a few MB for a large app.
  "/dsyms/*",
  "/fivetran/*",
  "/airbyte/*",
];

export const LARGE_REQUEST_BODY_ROUTES: ReadonlyArray<LargeRequestBodyRoute> = [
  {
    paths: ["/api/file"],
    limit: FILE_REQUEST_BODY_LIMIT,
    reason:
      "A file the Dashboard uploads - an attachment, an image in a note, a logo - travels as JSON, one number for each of its bytes. The Dashboard takes files of up to 10 MB: 36 MB of JSON.",
  },
  {
    paths: under(PROBE_INGEST_ROUTE_PREFIXES, [
      "/probe/vmware/collection",
      "/probe/openstack/collection",
    ]),
    limit: REPORT_REQUEST_BODY_LIMIT,
    readsBodyAfterAuthentication: true,
    reason:
      "A probe's collection of a vCenter or an OpenStack cloud is up to 48 MiB of OTLP metrics: millions of values, and a refused collection is lost. The probe's key is checked first, from its headers or from the start of its report, and a collection whose probe is not known by then is parsed only up to a large route's 1,000,000 values.",
  },
  {
    paths: ["/telemetry-writer/insert"],
    limit: REPORT_REQUEST_BODY_LIMIT,
    readsBodyAfterAuthentication: true,
    reason:
      "A forwarding pod's ClickHouse rows are up to 30 MB a request: millions of values, and refused rows are lost. The cluster key, in a header, is checked before the body is read.",
  },
  {
    paths: ["/probe-ingest/*", "/ingestor/*", "/probe/*"],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "What probes report: a synthetic monitor's screenshots (up to 50 MB a run), packet captures (up to 25 MB), SNMP walks, discovery scans and data store scans.",
  },
  {
    // Under /probe-ingest too, which the entry above takes.
    paths: ["/incoming-email/*"],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "An inbound email of up to 50 MB, attachments included, as its provider delivers it.",
  },
  {
    paths: under(SERVER_MONITOR_ROUTE_PREFIXES, ["/server-monitor/*"]),
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "The infrastructure agent's report on a host: every process, disk and network interface it has.",
  },
  {
    paths: under(INCOMING_REQUEST_ROUTE_PREFIXES, ["/incoming-request/*"]),
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "Whatever a system sends to an incoming request monitor (nginx sends /heartbeat here too). Bodies of up to 50 MB are documented as accepted.",
  },
  {
    paths: under(TELEMETRY_ROUTE_PREFIXES, TELEMETRY_INGEST_PATHS),
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "Batches of logs, events, profiles, source maps, dSYMs and dbt artifacts that collectors, agents and CI send, gzip-compressed or not, under /telemetry and at the root, as the ingress forwards each.",
  },
  {
    paths: ["/workflow/*", "/api/huntress/webhook/*"],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "A workflow's webhook trigger takes whatever the system that calls it sends, Huntress's incident reports among them, and the builder saves a workflow's whole graph, its code steps and all.",
  },
  {
    paths: [
      "/runbook/*",
      "/runner-ingest/*",
      "/runbook-agent-ingest/*",
      "/kubernetes-ai-agent-ingest/*",
      "/resource-ai-agent-ingest/*",
      "/api/ai-agent-data/*",
      "/api/ai-agent-task/*",
      "/api/ai-agent-task-log/*",
    ],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "Runners and agents report a job's result with the output of its commands, and the Runner's code agent sends model prompts as large as the model's context window, with the code they hold.",
  },
  {
    paths: ["/api/notification/*"],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "OneUptime's own services send every email, SMS, call, chat message and outgoing webhook through these routes: an email carries the whole note or announcement it tells of. A refused one is a notification lost.",
  },
  {
    paths: [
      "/api/form/public/:shareKey/submit",
      "/api/form/custom-domain/submit",
    ],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "A form submission carries its files, base64-encoded: up to 20 MB of them.",
  },
  {
    paths: [
      "/api/tool-import/upload",
      "/api/security-watchlist/import",
      "/api/incident-video-call/:callId/transcript",
    ],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "Files read in the browser and sent as text: another tool's export (up to 10 MB), a watchlist's values (up to 4 MB) and a call's transcript (up to 5 MB).",
  },
  {
    paths: [
      ...createAndUpdate("/status-page"),
      ...createAndUpdate("/status-page-subscriber-notification-template"),
      ...createAndUpdate("/dashboard"),
    ],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "A status page's custom HTML, CSS and JavaScript, an email template's HTML and a dashboard's widgets have no length limit, and may hold images and fonts inline.",
  },
  {
    paths: under(IDENTITY_ROUTE_PREFIXES, ["/scim/*", "/status-page-scim/*"]),
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "An identity provider provisions a group with all of its members in one request.",
  },
  {
    paths: ["/api/github/webhook", "/api/billing/webhook"],
    limit: LARGE_REQUEST_BODY_LIMIT,
    reason:
      "GitHub sends webhook payloads of up to 25 MB, and Stripe states no limit for an event: one refused is retried for three days, then lost.",
  },
];

interface CompiledPattern {
  segments: Array<string>;
  // A last segment "*": the path and everything under it.
  isPrefix: boolean;
  limit: RequestBodyLimit;
  readsBodyAfterAuthentication: boolean;
  // The more literal segments, the more specific: it wins.
  specificity: number;
}

// The segments of a path, in lower case, without empty ones.
const segmentsOf: (path: string) => Array<string> = (
  path: string,
): Array<string> => {
  return path
    .toLowerCase()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });
};

const compile: (
  routes: ReadonlyArray<LargeRequestBodyRoute>,
) => Map<string, Array<CompiledPattern>> = (
  routes: ReadonlyArray<LargeRequestBodyRoute>,
): Map<string, Array<CompiledPattern>> => {
  const byFirstSegment: Map<string, Array<CompiledPattern>> = new Map();

  for (const route of routes) {
    for (const path of route.paths) {
      const segments: Array<string> = segmentsOf(path);
      const isPrefix: boolean = segments[segments.length - 1] === "*";

      if (isPrefix) {
        segments.pop();
      }

      const literalSegments: number = segments.filter(
        (segment: string): boolean => {
          return !segment.startsWith(":");
        },
      ).length;

      const pattern: CompiledPattern = {
        segments: segments,
        isPrefix: isPrefix,
        limit: route.limit,
        readsBodyAfterAuthentication: Boolean(
          route.readsBodyAfterAuthentication,
        ),
        // An exact path wins over a prefix of as many segments.
        specificity: literalSegments * 2 + (isPrefix ? 0 : 1),
      };

      const first: string = segments[0] || "";
      const patterns: Array<CompiledPattern> = byFirstSegment.get(first) || [];
      patterns.push(pattern);
      byFirstSegment.set(first, patterns);
    }
  }

  return byFirstSegment;
};

const PATTERNS_BY_FIRST_SEGMENT: Map<string, Array<CompiledPattern>> = compile(
  LARGE_REQUEST_BODY_ROUTES,
);

const matches: (
  pattern: CompiledPattern,
  segments: Array<string>,
) => boolean = (pattern: CompiledPattern, segments: Array<string>): boolean => {
  if (
    pattern.isPrefix
      ? segments.length < pattern.segments.length
      : segments.length !== pattern.segments.length
  ) {
    return false;
  }

  return pattern.segments.every((segment: string, index: number): boolean => {
    return segment.startsWith(":") || segment === segments[index];
  });
};

// The most specific listed path a request's path is, or null for none.
const findPattern: (path: string) => CompiledPattern | null = (
  path: string,
): CompiledPattern | null => {
  const segments: Array<string> = segmentsOf(path || "");

  let best: CompiledPattern | null = null;

  for (const pattern of PATTERNS_BY_FIRST_SEGMENT.get(segments[0] || "") ||
    []) {
    if (
      matches(pattern, segments) &&
      (!best || pattern.specificity > best.specificity)
    ) {
      best = pattern;
    }
  }

  return best;
};

// The limit a request's body is held to: by its path, before routing.
export const getRequestBodyLimit: (path: string) => RequestBodyLimit = (
  path: string,
): RequestBodyLimit => {
  const pattern: CompiledPattern | null = findPattern(path);

  return pattern ? pattern.limit : ORDINARY_REQUEST_BODY_LIMIT;
};

/*
 * Whether a request's route reads the body itself, once it has checked who
 * sent it (LargeRequestBodyRoute.readsBodyAfterAuthentication), so
 * StartServer leaves the body unread. Matched as getRequestBodyLimit
 * matches: in any case, with or without a trailing slash, under every
 * prefix the route's router is mounted on.
 */
export const readsBodyAfterAuthentication: (path: string) => boolean = (
  path: string,
): boolean => {
  return Boolean(findPattern(path)?.readsBodyAfterAuthentication);
};

export default getRequestBodyLimit;
