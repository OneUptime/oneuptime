import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import http from "http";
import https from "https";
import net from "net";
import {
  StorageArrayHttpRequest,
  StorageArrayHttpResponse,
  StorageArrayTransport,
} from "../../../../../../Utils/StorageArray/StorageArrayTransport";
import { TestCertificate } from "../../../../VMware/Helpers/TestCertificates";
import {
  PERFORMANCE_CATEGORIES,
  REALTIME_HELP_METRICS,
  SYMMETRIX_LIST_KEY_PYU4V,
  VOLUME_METRIC_ENUM,
  enhancedError,
  realtimeAnswer,
  volumeMetricsAnswer,
} from "./UnisphereRecordings";

/*
 * A UNISPHERE FOR POWERMAX THAT ANSWERS AS DELL DOCUMENTS IT (#11004).
 *
 * The probe's poller talks to this the way it talks to a real Unisphere:
 * the same paths, the same Basic authentication, the same JSON - Dell's
 * own response examples (UnisphereRecordings) - and the same refusals:
 *
 *   - 401 for a wrong user name or password, on every path;
 *   - 403 for an account whose role may not make the call (Monitor for
 *     the arrays and their objects, PerfMonitor for performance), per
 *     array;
 *   - 400 for a query parameter or a selected attribute the server does
 *     not know (the enhanced endpoints reject both), and for `limit` on a
 *     Unisphere older than 10.3, which has no paging;
 *   - 404 for an object or path it does not have;
 *   - paging from 10.3, as the 10.3 change log describes it: `limit`, a
 *     `resume_token` and a `paging` object with `next`.
 *
 * It serves a transport the poller can be handed (in memory), or listens
 * on HTTPS with a certificate, for the tests of the real transport.
 */

export type UnisphereRole = "Monitor" | "PerfMonitor";

export interface FakeUnisphereUser {
  password: string;
  // Its roles on every array, unless arrayRoles names that array.
  roles: Array<UnisphereRole>;
  arrayRoles?: Record<string, Array<UnisphereRole>> | undefined;
  // May not even read the REST API's version (no role at all).
  isLockedOut?: boolean | undefined;
}

export interface FakeArray {
  symmetrixId: string;
  details: JSONObject;
  provisioning: JSONObject | null;
  srps: Record<string, JSONObject>;
  // Null: the health endpoint answers 404, as an older Unisphere does.
  health: JSONObject | null;
  alerts: Array<JSONObject>;
  classicDirectors: Record<string, JSONObject>;
  registration: JSONObject | null;
  storageGroups: Array<JSONObject>;
  volumes: Array<JSONObject>;
  directors: Array<JSONObject>;
  ports: Array<JSONObject>;
  rdfGroups: Array<JSONObject>;
  // Category -> metric_instances, as GET performance-categories/{category} answers.
  performance: Record<string, Array<JSONObject>>;
  realtimeMetrics: Array<string>;
  // Storage group -> 5-second points.
  realtime: Record<string, Array<JSONObject>>;
  volumeMetrics: Array<{
    volumeId: string;
    storageGroups: string;
    points: Array<JSONObject>;
  }>;
}

export interface FakeUnisphereOptions {
  version: JSONObject;
  users: Record<string, FakeUnisphereUser>;
  arrays: Array<FakeArray>;
  // How /system/symmetrix names its list: PyU4V's key or the OpenAPI example's.
  listKey?: string | undefined;
  // Attributes an enhanced endpoint of this version does not know, by object type.
  unknownAttributes?: Record<string, Array<string>> | undefined;
  // Answers for a path (a prefix of it), before anything else: status and body.
  overrides?: Array<{
    method?: "GET" | "POST" | undefined;
    pathPrefix: string;
    status: number;
    body: string;
    times?: number | undefined;
  }>;
  // Called before each answer, to delay one (a slow Unisphere).
  delayInMs?: ((request: StorageArrayHttpRequest) => number) | undefined;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | undefined;
  body: JSONObject | null;
}

const ENHANCED_TYPES: ReadonlyArray<string> = [
  "storage-groups",
  "volumes",
  "directors",
  "ports",
  "rdf-groups",
];

// Enhanced endpoints that need 10.3 (directors, ports, SRDF groups).
const ENHANCED_TYPES_FROM_10_3: ReadonlyArray<string> = [
  "directors",
  "ports",
  "rdf-groups",
];

const PAGING_PARAMS: ReadonlyArray<string> = [
  "limit",
  "limit_kb",
  "resume_token",
  "expiration_delay_secs",
];

function json(status: number, body: JSONValue): StorageArrayHttpResponse {
  return {
    status: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function readQuery(path: string): {
  pathname: string;
  query: Record<string, string>;
} {
  const [pathname, search] = path.split("?") as [string, string | undefined];
  const query: Record<string, string> = {};
  for (const part of (search || "").split("&")) {
    if (!part) {
      continue;
    }
    const [key, value] = part.split("=") as [string, string | undefined];
    query[decodeURIComponent(key)] = decodeURIComponent(value || "");
  }
  return { pathname, query };
}

// "a.b" -> pick b out of every element (or the object) under a.
function project(item: JSONObject, select: Array<string>): JSONObject {
  const out: JSONObject = {};
  for (const attribute of select) {
    const [head, tail] = attribute.split(".") as [string, string | undefined];
    const value: JSONValue | undefined = item[head];
    if (value === undefined) {
      continue;
    }
    if (!tail) {
      out[head] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const existing: JSONArray = (out[head] as JSONArray | undefined) || [];
      out[head] = (value as JSONArray).map(
        (element: JSONValue, index: number): JSONObject => {
          const previous: JSONObject = (existing[index] as JSONObject) || {};
          return {
            ...previous,
            [tail]: (element as JSONObject)?.[tail] ?? null,
          };
        },
      );
    } else if (value && typeof value === "object") {
      out[head] = {
        ...((out[head] as JSONObject) || {}),
        [tail]: (value as JSONObject)[tail] ?? null,
      };
    }
  }
  return out;
}

// The enhanced endpoints' filter: "num_of_storage_groups gt 0", comma separated.
function matches(item: JSONObject, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }
  for (const clause of filter.split(",")) {
    const [attribute, operator, value] = clause.trim().split(/\s+/) as [
      string,
      string,
      string,
    ];
    const actual: JSONValue | undefined = item[attribute];
    const number: number = Number(value);
    switch (operator) {
      case "gt":
        if (!(Number(actual) > number)) {
          return false;
        }
        break;
      case "eq":
        if (String(actual) !== value) {
          return false;
        }
        break;
      default:
        throw new Error(`The fake does not know the operator ${operator}`);
    }
  }
  return true;
}

export default class FakeUnisphere {
  public readonly options: FakeUnisphereOptions;
  public readonly requests: Array<RecordedRequest> = [];
  private readonly tokens: Map<
    string,
    { remaining: Array<JSONObject>; total: number }
  > = new Map();
  private tokenCounter: number = 0;
  private server: https.Server | null = null;
  private readonly sockets: Set<net.Socket> = new Set();

  public constructor(options: FakeUnisphereOptions) {
    this.options = options;
  }

  public get apiVersion(): number {
    return Number(this.options.version["api_version"]) || 0;
  }

  public array(symmetrixId: string): FakeArray {
    const array: FakeArray | undefined = this.options.arrays.find(
      (entry: FakeArray): boolean => {
        return entry.symmetrixId === symmetrixId;
      },
    );
    if (!array) {
      throw new Error(`The fake has no array ${symmetrixId}`);
    }
    return array;
  }

  // The requests made to a path (without its query), in order.
  public requestsTo(pathname: string): Array<RecordedRequest> {
    return this.requests.filter((request: RecordedRequest): boolean => {
      return request.path === pathname;
    });
  }

  public transport(): StorageArrayTransport {
    return async (
      request: StorageArrayHttpRequest,
    ): Promise<StorageArrayHttpResponse> => {
      const delay: number = this.options.delayInMs?.(request) || 0;
      if (delay > 0) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, delay);
        });
      }
      return this.handle(request);
    };
  }

  public handle(request: StorageArrayHttpRequest): StorageArrayHttpResponse {
    const { pathname, query } = readQuery(request.path);
    const authorization: string | undefined =
      request.headers["Authorization"] || request.headers["authorization"];
    let body: JSONObject | null = null;
    if (request.body) {
      body = JSON.parse(request.body) as JSONObject;
    }
    this.requests.push({
      method: request.method,
      path: pathname,
      query,
      authorization,
      body,
    });

    for (const override of this.options.overrides || []) {
      if (
        (!override.method || override.method === request.method) &&
        pathname.startsWith(override.pathPrefix) &&
        (override.times === undefined || override.times > 0)
      ) {
        if (override.times !== undefined) {
          override.times--;
        }
        return {
          status: override.status,
          headers: { "content-type": "application/json" },
          body: override.body,
        };
      }
    }

    // Basic authentication, on every path.
    const user: FakeUnisphereUser | null = this.authenticate(authorization);
    if (!user) {
      return {
        status: 401,
        headers: { "content-type": "text/html" },
        body: "<html><body>Unauthorized</body></html>",
      };
    }
    if (user.isLockedOut) {
      return json(403, { message: "Forbidden" });
    }

    if (pathname === "/univmax/restapi/version" && request.method === "GET") {
      return json(200, this.options.version);
    }

    const classic: RegExpMatchArray | null = pathname.match(
      /^\/univmax\/restapi\/(\d{2,3})(\/.*)$/,
    );
    if (classic) {
      if (
        !(
          (this.options.version["supported_api_versions"] as Array<string>) ||
          []
        ).includes(classic[1]!)
      ) {
        return json(404, { message: "HTTP 404 Not Found" });
      }
      return this.classic(user, classic[2]!, query);
    }

    if (pathname.startsWith("/univmax/restapi/performance/")) {
      return this.performance(
        user,
        pathname.slice("/univmax/restapi/performance".length),
        request.method,
        body,
      );
    }

    const enhanced: RegExpMatchArray | null = pathname.match(
      /^\/univmax\/rest\/v1\/systems\/(\d{12})\/([a-z-]+)(?:\/([A-Za-z]+))?$/,
    );
    if (enhanced && this.apiVersion >= 101) {
      return this.enhanced(
        user,
        enhanced[1]!,
        enhanced[2]!,
        enhanced[3],
        query,
      );
    }

    return json(404, { message: "HTTP 404 Not Found" });
  }

  private authenticate(
    authorization: string | undefined,
  ): FakeUnisphereUser | null {
    if (!authorization || !authorization.startsWith("Basic ")) {
      return null;
    }
    const decoded: string = Buffer.from(
      authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8");
    const separator: number = decoded.indexOf(":");
    const name: string = decoded.slice(0, separator);
    const password: string = decoded.slice(separator + 1);
    const user: FakeUnisphereUser | undefined = this.options.users[name];
    return user && user.password === password ? user : null;
  }

  private may(
    user: FakeUnisphereUser,
    symmetrixId: string | null,
    role: UnisphereRole,
  ): boolean {
    const roles: Array<UnisphereRole> =
      (symmetrixId && user.arrayRoles?.[symmetrixId]) || user.roles;
    return roles.includes(role);
  }

  private forbidden(): StorageArrayHttpResponse {
    return json(403, {
      message: "The user does not have permission to perform this operation.",
    });
  }

  private classic(
    user: FakeUnisphereUser,
    path: string,
    query: Record<string, string>,
  ): StorageArrayHttpResponse {
    if (path === "/system/symmetrix") {
      if (
        !this.may(user, null, "Monitor") &&
        !Object.values(user.arrayRoles || {}).some(
          (roles: Array<UnisphereRole>) => {
            return roles.includes("Monitor");
          },
        )
      ) {
        return this.forbidden();
      }
      return json(200, {
        [this.options.listKey || SYMMETRIX_LIST_KEY_PYU4V]:
          this.options.arrays.map((array: FakeArray): string => {
            return array.symmetrixId;
          }),
      });
    }

    const match: RegExpMatchArray | null = path.match(
      /^\/(system|sloprovisioning)\/symmetrix\/(\d{12})(\/.*)?$/,
    );
    if (!match) {
      return json(404, { message: "HTTP 404 Not Found" });
    }
    const [, area, symmetrixId, rest] = match as unknown as [
      string,
      string,
      string,
      string | undefined,
    ];
    const array: FakeArray | undefined = this.options.arrays.find(
      (entry: FakeArray): boolean => {
        return entry.symmetrixId === symmetrixId;
      },
    );
    if (!array) {
      return json(404, {
        message: `Cannot find Symmetrix with ID: ${symmetrixId}`,
      });
    }
    if (!this.may(user, symmetrixId, "Monitor")) {
      return this.forbidden();
    }

    if (area === "system") {
      if (!rest) {
        return json(200, array.details);
      }
      if (rest === "/health") {
        return array.health
          ? json(200, array.health)
          : json(404, { message: "HTTP 404 Not Found" });
      }
      if (rest === "/alert") {
        for (const key of Object.keys(query)) {
          if (!["acknowledged", "severity", "state", "type"].includes(key)) {
            return json(400, { message: `Unknown query parameter ${key}` });
          }
        }
        return json(200, {
          alertId: array.alerts
            .filter((alert: JSONObject): boolean => {
              return (
                (query["acknowledged"] === undefined ||
                  String(alert["acknowledged"]) === query["acknowledged"]) &&
                (query["severity"] === undefined ||
                  alert["severity"] === query["severity"])
              );
            })
            .map((alert: JSONObject): string => {
              return String(alert["alertId"]);
            }),
        });
      }
      const alertMatch: RegExpMatchArray | null = rest.match(/^\/alert\/(.+)$/);
      if (alertMatch) {
        const found: JSONObject | undefined = array.alerts.find(
          (alert: JSONObject): boolean => {
            return alert["alertId"] === decodeURIComponent(alertMatch[1]!);
          },
        );
        return found
          ? json(200, found)
          : json(404, { message: "Cannot find alert" });
      }
      if (rest === "/director") {
        return json(200, { directorId: Object.keys(array.classicDirectors) });
      }
      const directorMatch: RegExpMatchArray | null = rest.match(
        /^\/director\/([^/]+)$/,
      );
      if (directorMatch) {
        const director: JSONObject | undefined =
          array.classicDirectors[decodeURIComponent(directorMatch[1]!)];
        return director
          ? json(200, director)
          : json(404, { message: "Cannot find director" });
      }
      return json(404, { message: "HTTP 404 Not Found" });
    }

    // sloprovisioning
    if (!rest) {
      return array.provisioning
        ? json(200, array.provisioning)
        : json(404, { message: "HTTP 404 Not Found" });
    }
    if (rest === "/srp") {
      return json(200, { srpId: Object.keys(array.srps) });
    }
    const srpMatch: RegExpMatchArray | null = rest.match(/^\/srp\/([^/]+)$/);
    if (srpMatch) {
      const srp: JSONObject | undefined =
        array.srps[decodeURIComponent(srpMatch[1]!)];
      return srp ? json(200, srp) : json(404, { message: "Cannot find SRP" });
    }
    return json(404, { message: "HTTP 404 Not Found" });
  }

  private performance(
    user: FakeUnisphereUser,
    path: string,
    method: string,
    body: JSONObject | null,
  ): StorageArrayHttpResponse {
    const registration: RegExpMatchArray | null = path.match(
      /^\/Array\/registrationdetails\/(\d{12})$/,
    );
    if (registration && method === "GET") {
      const array: FakeArray = this.array(registration[1]!);
      if (!this.may(user, array.symmetrixId, "PerfMonitor")) {
        return this.forbidden();
      }
      return array.registration
        ? json(200, array.registration)
        : json(200, { registrationDetailsInfo: [] });
    }

    const help: RegExpMatchArray | null = path.match(
      /^\/realtime\/help\/(\d{12})\/([A-Za-z]+)\/metrics$/,
    );
    if (help && method === "GET") {
      const array: FakeArray = this.array(help[1]!);
      if (!this.may(user, array.symmetrixId, "PerfMonitor")) {
        return this.forbidden();
      }
      return json(200, {
        metricName:
          help[2] === "StorageGroups"
            ? array.realtimeMetrics
            : REALTIME_HELP_METRICS,
      });
    }

    if (path === "/realtime/metrics" && method === "POST" && body) {
      const array: FakeArray = this.array(String(body["symmetrixId"]));
      if (!this.may(user, array.symmetrixId, "PerfMonitor")) {
        return this.forbidden();
      }
      const metrics: Array<string> = (body["metrics"] as Array<string>) || [];
      // A metric the category does not have refuses the whole query.
      for (const metric of metrics) {
        if (!array.realtimeMetrics.includes(metric)) {
          return json(400, {
            message: `The supplied real-time metrics [${metric}] are not valid for StorageGroups`,
          });
        }
      }
      const points: Array<JSONObject> =
        array.realtime[String(body["instanceId"])] || [];
      return json(
        200,
        realtimeAnswer(
          points
            .filter((point: JSONObject): boolean => {
              const time: number = Number(point["timestamp"]);
              return (
                time >= Number(body["startDate"]) &&
                time <= Number(body["endDate"])
              );
            })
            .map((point: JSONObject): JSONObject => {
              return project(point, [...metrics, "timestamp"]);
            }),
        ),
      );
    }

    if (path === "/Volume/metrics" && method === "POST" && body) {
      const array: FakeArray = this.array(String(body["systemId"]));
      if (!this.may(user, array.symmetrixId, "PerfMonitor")) {
        return this.forbidden();
      }
      const metrics: Array<string> = (body["metrics"] as Array<string>) || [];
      for (const metric of metrics) {
        if (!VOLUME_METRIC_ENUM.includes(metric)) {
          return json(400, {
            message: `Metric ${metric} is not a valid Volume metric`,
          });
        }
      }
      const groups: Array<string> = String(
        body["commaSeparatedStorageGroupList"] || "",
      ).split(",");
      if (groups.length > 100) {
        return json(400, {
          message: "At most 100 storage groups may be queried",
        });
      }
      if (Number(body["endDate"]) - Number(body["startDate"]) > 3_600_000) {
        return json(400, { message: "The time range is longer than an hour" });
      }
      return json(
        200,
        volumeMetricsAnswer(
          array.volumeMetrics
            .filter((volume: { storageGroups: string }): boolean => {
              return groups.includes(volume.storageGroups);
            })
            .map(
              (volume: {
                volumeId: string;
                storageGroups: string;
                points: Array<JSONObject>;
              }) => {
                return {
                  ...volume,
                  points: volume.points.map((point: JSONObject): JSONObject => {
                    return project(point, [...metrics, "timestamp"]);
                  }),
                };
              },
            ),
        ),
      );
    }

    return json(404, { message: "HTTP 404 Not Found" });
  }

  private enhanced(
    user: FakeUnisphereUser,
    symmetrixId: string,
    objectType: string,
    category: string | undefined,
    query: Record<string, string>,
  ): StorageArrayHttpResponse {
    const array: FakeArray | undefined = this.options.arrays.find(
      (entry: FakeArray): boolean => {
        return entry.symmetrixId === symmetrixId;
      },
    );
    if (!array) {
      return json(
        404,
        enhancedError(404, "0x0101", `System ${symmetrixId} not found`),
      );
    }

    if (objectType === "performance-categories") {
      if (!this.may(user, symmetrixId, "PerfMonitor")) {
        return json(403, enhancedError(403, "0x0403", "Forbidden"));
      }
      if (!category) {
        return json(200, {
          performance_categories: Object.keys(array.performance).map(
            (id: string): JSONObject => {
              return {
                id: id,
                resource_type: "performance-categories",
                system: symmetrixId,
                metrics: PERFORMANCE_CATEGORIES[id] || [],
              };
            },
          ),
        });
      }
      const instances: Array<JSONObject> | undefined =
        array.performance[category];
      if (!instances) {
        return json(
          400,
          enhancedError(
            400,
            "0x0207",
            `Category ${category} has no data for ${symmetrixId}`,
          ),
        );
      }
      return json(200, {
        id: category,
        resource_type: "performance-categories",
        system: symmetrixId,
        metric_instances: instances,
      });
    }

    if (!ENHANCED_TYPES.includes(objectType) || category) {
      return json(404, { message: "HTTP 404 Not Found" });
    }
    if (
      ENHANCED_TYPES_FROM_10_3.includes(objectType) &&
      this.apiVersion < 103
    ) {
      return json(404, { message: "HTTP 404 Not Found" });
    }
    if (!this.may(user, symmetrixId, "Monitor")) {
      return json(403, enhancedError(403, "0x0403", "Forbidden"));
    }

    const allowed: Array<string> = [
      "select",
      "filter",
      ...(this.apiVersion >= 103 ? PAGING_PARAMS : []),
    ];
    for (const key of Object.keys(query)) {
      if (!allowed.includes(key)) {
        return json(
          400,
          enhancedError(400, "0x0001", `Unknown query parameter: ${key}`),
        );
      }
    }

    const select: Array<string> = (query["select"] || "")
      .split(",")
      .filter(Boolean);
    const unknown: Array<string> =
      this.options.unknownAttributes?.[objectType] || [];
    for (const attribute of select) {
      if (unknown.includes(attribute)) {
        return json(
          400,
          enhancedError(400, "0x0002", `Unknown attribute: ${attribute}`),
        );
      }
    }

    const listKey: string =
      objectType === "storage-groups" || objectType === "volumes"
        ? objectType.replace(/-/g, "_")
        : "results";

    const source: Array<JSONObject> = {
      "storage-groups": array.storageGroups,
      volumes: array.volumes,
      directors: array.directors,
      ports: array.ports,
      "rdf-groups": array.rdfGroups,
    }[objectType] as Array<JSONObject>;

    const all: Array<JSONObject> = source
      .filter((item: JSONObject): boolean => {
        return matches(item, query["filter"]);
      })
      .map((item: JSONObject): JSONObject => {
        return select.length ? project(item, select) : item;
      });

    if (query["resume_token"]) {
      const page: { remaining: Array<JSONObject>; total: number } | undefined =
        this.tokens.get(query["resume_token"]);
      if (!page) {
        return json(
          400,
          enhancedError(
            400,
            "0x0309",
            "A problem occurred retrieving the Storage Groups resource: No entry found for specified resume token, token could be expired",
          ),
        );
      }
      this.tokens.delete(query["resume_token"]);
      return this.page(
        listKey,
        page.remaining,
        page.total,
        Number(query["limit"]) || page.remaining.length,
        symmetrixId,
        objectType,
        query,
      );
    }

    if (query["limit"] !== undefined) {
      return this.page(
        listKey,
        all,
        all.length,
        Number(query["limit"]),
        symmetrixId,
        objectType,
        query,
      );
    }

    return json(200, { [listKey]: all });
  }

  private page(
    listKey: string,
    items: Array<JSONObject>,
    total: number,
    limit: number,
    symmetrixId: string,
    objectType: string,
    query: Record<string, string>,
  ): StorageArrayHttpResponse {
    const size: number = Math.max(0, limit);
    const page: Array<JSONObject> = items.slice(0, size);
    const remaining: Array<JSONObject> = items.slice(size);
    const paging: JSONObject = {
      total_instances: total,
      remaining_instances: remaining.length,
    };
    if (remaining.length > 0) {
      const token: string = `token-${++this.tokenCounter}`;
      this.tokens.set(token, { remaining, total });
      paging["resume_token_expiration_date_ms"] = Date.now() + 60_000;
      paging["resume_token"] = token;
      const nextQuery: Array<string> = [
        `resume_token=${token}`,
        `limit=${limit}`,
      ];
      for (const key of ["select", "filter", "expiration_delay_secs"]) {
        if (query[key]) {
          nextQuery.push(`${key}=${encodeURIComponent(query[key]!)}`);
        }
      }
      // As the 10.3 change log shows it: under /rest, not /univmax/rest.
      paging["next"] =
        `/rest/v1/systems/${symmetrixId}/${objectType}?${nextQuery.join("&")}`;
    }
    return json(200, { [listKey]: page, paging });
  }

  // ---------------- HTTPS ----------------

  public async listen(certificate: TestCertificate): Promise<number> {
    this.server = https.createServer(
      { key: certificate.key, cert: certificate.cert },
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        const chunks: Array<Buffer> = [];
        request.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        request.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            }
          }
          const answer: StorageArrayHttpResponse = this.handle({
            method: request.method === "POST" ? "POST" : "GET",
            path: request.url || "/",
            headers: headers,
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          });
          response.writeHead(answer.status, {
            "content-type": String(
              answer.headers["content-type"] || "application/json",
            ),
          });
          response.end(answer.body);
        });
      },
    );
    this.server.on("connection", (socket: net.Socket) => {
      this.sockets.add(socket);
      socket.on("close", () => {
        this.sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    return (this.server.address() as net.AddressInfo).port;
  }

  public async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    if (this.server) {
      await new Promise<void>((resolve: () => void) => {
        this.server!.close(() => {
          resolve();
        });
      });
      this.server = null;
    }
  }
}
