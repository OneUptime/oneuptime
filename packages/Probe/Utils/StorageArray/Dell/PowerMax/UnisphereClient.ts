import {
  STORAGE_ARRAY_USER_AGENT,
  StorageArrayHttpResponse,
  StorageArrayTransport,
} from "../../StorageArrayTransport";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * THE UNISPHERE FOR POWERMAX REST API, AS A PROBE READS IT (#11004).
 *
 * Read-only: every call is a GET, or one of Unisphere's performance
 * queries (a POST that changes nothing). Dell documents them in the
 * "PowerMax" and "PowerMax - Enhanced Endpoints" OpenAPI documents and the
 * REST API change logs, and its own SDK, PyU4V, makes the same calls:
 *
 *   /univmax/restapi/version                       the server's version
 *   /univmax/restapi/{v}/system/symmetrix[/{id}]   the arrays, one array
 *   /univmax/restapi/{v}/sloprovisioning/symmetrix/{id}[/srp[/{srp}]]
 *                                                  capacity, pools
 *   /univmax/restapi/{v}/system/symmetrix/{id}/health
 *   /univmax/restapi/{v}/system/symmetrix/{id}/alert[/{alertId}]
 *   /univmax/restapi/{v}/system/symmetrix/{id}/director[/{dir}]
 *   /univmax/restapi/performance/Array/registrationdetails/{id}
 *   /univmax/restapi/performance/realtime/help/{id}/{category}/metrics
 *   /univmax/restapi/performance/realtime/metrics  (POST)
 *   /univmax/restapi/performance/Volume/metrics    (POST)
 *   /univmax/rest/v1/systems/{id}/{storage-groups|volumes|directors|ports|rdf-groups}
 *   /univmax/rest/v1/systems/{id}/performance-categories[/{category}]
 *
 * The enhanced ("PowerAPI") endpoints answer every object of a kind in one
 * call, with only the attributes asked for (`select`), paged from
 * Unisphere 10.3 (`limit`, `resume_token`). They need Unisphere 10.1;
 * directors, ports and SRDF groups need 10.3.
 *
 * Basic authentication on every request, as Unisphere's REST API takes it:
 * 401 is a wrong user name or password, 403 an account whose role may not
 * make the call.
 */

export const UNISPHERE_REST_BASE: string = "/univmax/restapi";
export const UNISPHERE_ENHANCED_BASE: string = "/univmax/rest/v1";

// What OneUptime tells Unisphere it is, for Unisphere's own audit log.
export const UNISPHERE_APPLICATION_TYPE: string = "OneUptime";

export interface UnisphereVersion {
  // "T10.1.0.468", "V10.0.1.12".
  version: string;
  // "101".
  apiVersion: string;
  supportedApiVersions: Array<string>;
}

export interface UnispherePage {
  items: Array<JSONObject>;
  // How many there are, when the server said so.
  total: number;
  // The list was cut at the limit asked for.
  isTruncated: boolean;
}

export interface UnispherePerformanceInstance {
  id: string;
  metrics: Record<string, number>;
  timestampMs: number | null;
}

export interface UnisphereTimedPoint {
  timestampMs: number;
  metrics: Record<string, number>;
}

export class UnisphereHttpError extends Error {
  public readonly status: number;
  public readonly path: string;
  // Enhanced endpoints' error codes ("0x0309").
  public readonly codes: Array<string>;
  public readonly serverMessage: string;

  public constructor(data: {
    status: number;
    path: string;
    serverMessage: string;
    codes: Array<string>;
  }) {
    super(
      `Unisphere answered ${data.path.split("?")[0]} with HTTP ${data.status}${
        data.serverMessage ? `: ${data.serverMessage}` : ""
      }`,
    );
    this.name = "UnisphereHttpError";
    this.status = data.status;
    this.path = data.path;
    this.codes = data.codes;
    this.serverMessage = data.serverMessage;
  }
}

// An answer that is not Unisphere's JSON: not its REST API at all.
export class UnisphereNotRestApiError extends Error {
  public constructor(path: string, detail: string) {
    super(
      `${path.split("?")[0]} did not answer as Unisphere's REST API: ${detail}`,
    );
    this.name = "UnisphereNotRestApiError";
  }
}

function isObject(value: JSONValue | unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

// A query string with commas, dots and parentheses as Unisphere reads them.
export function toQueryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const parts: Array<string> = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))
        .replace(/%2C/gi, ",")
        .replace(/%3B/gi, ";")
        .replace(/%28/gi, "(")
        .replace(/%29/gi, ")")}`,
    );
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// A REST API version as Unisphere lists one: "101", "92".
const API_VERSION_PATTERN: RegExp = /^\d{2,3}$/;

/*
 * "T10.1.0.468" -> 101; "V9.2.1.4" -> 92. Null for anything else.
 */
export function readApiVersionNumber(value: unknown): number | null {
  const text: string | null = toText(value);
  if (!text) {
    return null;
  }
  if (API_VERSION_PATTERN.test(text)) {
    return Number(text);
  }
  const match: RegExpMatchArray | null = text.match(/^[A-Za-z]?(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return Number(`${match[1]}${match[2]}`);
}

export default class UnisphereClient {
  private readonly transport: StorageArrayTransport;
  private readonly authorization: string;
  private apiVersion: string = "101";

  public constructor(data: {
    transport: StorageArrayTransport;
    username: string;
    password: string;
  }) {
    this.transport = data.transport;
    this.authorization = `Basic ${Buffer.from(
      `${data.username}:${data.password}`,
      "utf8",
    ).toString("base64")}`;
  }

  public setApiVersion(apiVersion: string): void {
    this.apiVersion = apiVersion;
  }

  public getApiVersion(): string {
    return this.apiVersion;
  }

  public getApiVersionNumber(): number {
    return Number(this.apiVersion) || 0;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "application/json",
      "User-Agent": STORAGE_ARRAY_USER_AGENT,
      "Application-Type": UNISPHERE_APPLICATION_TYPE,
    };
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private parse(path: string, response: StorageArrayHttpResponse): unknown {
    const body: string = response.body || "";

    if (response.status < 200 || response.status > 299) {
      let serverMessage: string = "";
      const codes: Array<string> = [];
      try {
        const parsed: unknown = JSON.parse(body);
        if (isObject(parsed)) {
          serverMessage = toText(parsed["message"]) || "";
          if (Array.isArray(parsed["messages"])) {
            for (const entry of parsed["messages"] as JSONArray) {
              if (isObject(entry)) {
                const code: string | null = toText(entry["code"]);
                if (code) {
                  codes.push(code);
                }
              }
            }
          }
        }
      } catch {
        // An HTML error page or nothing: the status says enough.
      }
      throw new UnisphereHttpError({
        status: response.status,
        path: path,
        serverMessage: serverMessage.slice(0, 300),
        codes: codes,
      });
    }

    if (!body.trim()) {
      return {};
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new UnisphereNotRestApiError(path, "its answer is not JSON.");
    }
  }

  public async get(path: string): Promise<unknown> {
    const response: StorageArrayHttpResponse = await this.transport({
      method: "GET",
      path: path,
      headers: this.headers(false),
    });
    return this.parse(path, response);
  }

  public async post(path: string, body: JSONObject): Promise<unknown> {
    const response: StorageArrayHttpResponse = await this.transport({
      method: "POST",
      path: path,
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    return this.parse(path, response);
  }

  private classic(path: string): string {
    return `${UNISPHERE_REST_BASE}/${this.apiVersion}${path}`;
  }

  // ---------------- The server ----------------

  public async getVersion(): Promise<UnisphereVersion> {
    const path: string = `${UNISPHERE_REST_BASE}/version`;
    const body: unknown = await this.get(path);
    if (!isObject(body) || !toText(body["version"])) {
      throw new UnisphereNotRestApiError(path, "it names no version.");
    }
    const version: string = toText(body["version"])!;
    const apiVersion: string =
      toText(body["api_version"]) ||
      String(readApiVersionNumber(version) || "");
    const supported: Array<string> = (
      Array.isArray(body["supported_api_versions"])
        ? (body["supported_api_versions"] as JSONArray)
        : []
    )
      .map((entry: JSONValue): string | null => {
        return toText(entry);
      })
      .filter((entry: string | null): entry is string => {
        return entry !== null && API_VERSION_PATTERN.test(entry);
      });
    return {
      version: version,
      apiVersion: apiVersion,
      supportedApiVersions: supported.length ? supported : [apiVersion],
    };
  }

  // ---------------- Arrays ----------------

  public async listArrayIds(): Promise<Array<string>> {
    const body: unknown = await this.get(this.classic("/system/symmetrix"));
    if (!isObject(body)) {
      return [];
    }
    // PyU4V reads symmetrixId; Dell's OpenAPI example writes symmetrixIds.
    const list: unknown = body["symmetrixId"] || body["symmetrixIds"];
    return (Array.isArray(list) ? list : [])
      .map((id: unknown): string | null => {
        return toText(id);
      })
      .filter((id: string | null): id is string => {
        return id !== null;
      });
  }

  public async getSystemArray(symmetrixId: string): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(`/system/symmetrix/${encodeURIComponent(symmetrixId)}`),
      ),
    );
  }

  public async getProvisioningArray(symmetrixId: string): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(
          `/sloprovisioning/symmetrix/${encodeURIComponent(symmetrixId)}`,
        ),
      ),
    );
  }

  public async getHealth(symmetrixId: string): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(
          `/system/symmetrix/${encodeURIComponent(symmetrixId)}/health`,
        ),
      ),
    );
  }

  public async listSrpIds(symmetrixId: string): Promise<Array<string>> {
    const body: JSONObject = this.object(
      await this.get(
        this.classic(
          `/sloprovisioning/symmetrix/${encodeURIComponent(symmetrixId)}/srp`,
        ),
      ),
    );
    return this.textList(body["srpId"]);
  }

  public async getSrp(symmetrixId: string, srpId: string): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(
          `/sloprovisioning/symmetrix/${encodeURIComponent(
            symmetrixId,
          )}/srp/${encodeURIComponent(srpId)}`,
        ),
      ),
    );
  }

  // ---------------- Alerts ----------------

  // The ids of the array's alerts nobody acknowledged, of one severity.
  public async listOpenAlertIds(
    symmetrixId: string,
    severity: string,
  ): Promise<Array<string>> {
    const body: JSONObject = this.object(
      await this.get(
        `${this.classic(
          `/system/symmetrix/${encodeURIComponent(symmetrixId)}/alert`,
        )}${toQueryString({ acknowledged: "false", severity: severity })}`,
      ),
    );
    return this.textList(body["alertId"]);
  }

  public async getAlert(
    symmetrixId: string,
    alertId: string,
  ): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(
          `/system/symmetrix/${encodeURIComponent(
            symmetrixId,
          )}/alert/${encodeURIComponent(alertId)}`,
        ),
      ),
    );
  }

  // ---------------- Directors, the classic way (Unisphere 10.1, 10.2) ----------------

  public async listDirectorIds(symmetrixId: string): Promise<Array<string>> {
    const body: JSONObject = this.object(
      await this.get(
        this.classic(
          `/system/symmetrix/${encodeURIComponent(symmetrixId)}/director`,
        ),
      ),
    );
    return this.textList(body["directorId"]);
  }

  public async getDirector(
    symmetrixId: string,
    directorId: string,
  ): Promise<JSONObject> {
    return this.object(
      await this.get(
        this.classic(
          `/system/symmetrix/${encodeURIComponent(
            symmetrixId,
          )}/director/${encodeURIComponent(directorId)}`,
        ),
      ),
    );
  }

  // ---------------- Performance ----------------

  public async getRegistrationDetails(
    symmetrixId: string,
  ): Promise<JSONObject | null> {
    const body: JSONObject = this.object(
      await this.get(
        `${UNISPHERE_REST_BASE}/performance/Array/registrationdetails/${encodeURIComponent(
          symmetrixId,
        )}`,
      ),
    );
    const details: unknown = body["registrationDetailsInfo"];
    if (Array.isArray(details) && details.length > 0 && isObject(details[0])) {
      return details[0] as JSONObject;
    }
    return null;
  }

  // The performance categories Unisphere has for the array (10.1+).
  public async listPerformanceCategories(
    symmetrixId: string,
  ): Promise<Array<string>> {
    const body: JSONObject = this.object(
      await this.get(
        `${UNISPHERE_ENHANCED_BASE}/systems/${encodeURIComponent(
          symmetrixId,
        )}/performance-categories`,
      ),
    );
    const categories: unknown = body["performance_categories"];
    return (Array.isArray(categories) ? categories : [])
      .map((entry: unknown): string | null => {
        return isObject(entry) ? toText(entry["id"]) : toText(entry);
      })
      .filter((id: string | null): id is string => {
        return id !== null;
      });
  }

  /*
   * The KPI metrics of every instance of a category, for the last 5-minute
   * diagnostic interval (10.1+): one call, whatever the number of
   * instances. Each instance keeps its newest sample.
   */
  public async getPerformanceCategory(
    symmetrixId: string,
    category: string,
  ): Promise<Array<UnispherePerformanceInstance>> {
    const body: JSONObject = this.object(
      await this.get(
        `${UNISPHERE_ENHANCED_BASE}/systems/${encodeURIComponent(
          symmetrixId,
        )}/performance-categories/${encodeURIComponent(category)}`,
      ),
    );
    const instances: unknown = body["metric_instances"];
    const result: Array<UnispherePerformanceInstance> = [];
    for (const instance of Array.isArray(instances) ? instances : []) {
      if (!isObject(instance)) {
        continue;
      }
      const id: string | null = toText(instance["id"]);
      if (!id) {
        continue;
      }
      let newest: JSONObject | null = null;
      let newestTime: number = -1;
      for (const sample of Array.isArray(instance["metrics"])
        ? (instance["metrics"] as JSONArray)
        : []) {
        if (!isObject(sample)) {
          continue;
        }
        const time: number = toNumber(sample["timestamp"]) ?? 0;
        if (time >= newestTime) {
          newestTime = time;
          newest = sample;
        }
      }
      if (!newest) {
        continue;
      }
      const metrics: Record<string, number> = {};
      for (const [key, value] of Object.entries(newest)) {
        if (key === "timestamp") {
          continue;
        }
        const number: number | null = toNumber(value);
        if (number !== null) {
          metrics[key] = number;
        }
      }
      result.push({
        id: id,
        metrics: metrics,
        timestampMs: newestTime > 0 ? newestTime : null,
      });
    }
    return result;
  }

  /*
   * The metrics a real-time category has on an array, as Unisphere lists
   * them: a real-time query naming one it lacks is refused whole, and
   * Dell's documents list each category's only by asking (PyU4V's
   * get_category_metrics reads the same).
   */
  public async listRealtimeMetrics(
    symmetrixId: string,
    category: string,
  ): Promise<Array<string>> {
    const body: JSONObject = this.object(
      await this.get(
        `${UNISPHERE_REST_BASE}/performance/realtime/help/${encodeURIComponent(
          symmetrixId,
        )}/${encodeURIComponent(category)}/metrics`,
      ),
    );
    return this.textList(body["metricName"]);
  }

  /*
   * A storage group's real-time samples (every 5 seconds) between two
   * times, for a group registered for real-time collection.
   */
  public async getRealtimeStorageGroupMetrics(data: {
    symmetrixId: string;
    storageGroupId: string;
    startMs: number;
    endMs: number;
    metrics: Array<string>;
  }): Promise<Array<UnisphereTimedPoint>> {
    const body: unknown = await this.post(
      `${UNISPHERE_REST_BASE}/performance/realtime/metrics`,
      {
        symmetrixId: data.symmetrixId,
        category: "StorageGroups",
        instanceId: data.storageGroupId,
        metrics: data.metrics,
        startDate: data.startMs,
        endDate: data.endMs,
      },
    );
    return this.readResultList(body);
  }

  /*
   * Every volume's metrics in the storage groups named (up to 100, all
   * registered for real-time collection), over at most an hour.
   */
  public async getVolumeMetrics(data: {
    symmetrixId: string;
    storageGroupIds: Array<string>;
    startMs: number;
    endMs: number;
    metrics: Array<string>;
  }): Promise<
    Array<{
      volumeId: string;
      storageGroups: string | null;
      points: Array<UnisphereTimedPoint>;
    }>
  > {
    const body: unknown = await this.post(
      `${UNISPHERE_REST_BASE}/performance/Volume/metrics`,
      {
        systemId: data.symmetrixId,
        commaSeparatedStorageGroupList: data.storageGroupIds.join(","),
        startDate: data.startMs,
        endDate: data.endMs,
        dataFormat: "Average",
        metrics: data.metrics,
      },
    );
    const volumes: Array<{
      volumeId: string;
      storageGroups: string | null;
      points: Array<UnisphereTimedPoint>;
    }> = [];
    const results: unknown = isObject(body)
      ? (body["resultList"] as JSONObject | undefined)?.["result"]
      : undefined;
    for (const entry of Array.isArray(results) ? results : []) {
      if (!isObject(entry)) {
        continue;
      }
      const volumeId: string | null = toText(entry["volumeId"]);
      if (!volumeId) {
        continue;
      }
      volumes.push({
        volumeId: volumeId,
        storageGroups: toText(entry["storageGroups"]),
        points: this.readPoints(entry["volumeResult"]),
      });
    }
    return volumes;
  }

  private readResultList(body: unknown): Array<UnisphereTimedPoint> {
    const results: unknown = isObject(body)
      ? (body["resultList"] as JSONObject | undefined)?.["result"]
      : undefined;
    return this.readPoints(results);
  }

  private readPoints(list: unknown): Array<UnisphereTimedPoint> {
    const points: Array<UnisphereTimedPoint> = [];
    for (const sample of Array.isArray(list) ? list : []) {
      if (!isObject(sample)) {
        continue;
      }
      const timestamp: number | null = toNumber(sample["timestamp"]);
      if (timestamp === null || timestamp <= 0) {
        continue;
      }
      const metrics: Record<string, number> = {};
      for (const [key, value] of Object.entries(sample)) {
        if (key === "timestamp") {
          continue;
        }
        const number: number | null = toNumber(value);
        if (number !== null) {
          metrics[key] = number;
        }
      }
      points.push({ timestampMs: timestamp, metrics: metrics });
    }
    return points.sort(
      (a: UnisphereTimedPoint, b: UnisphereTimedPoint): number => {
        return a.timestampMs - b.timestampMs;
      },
    );
  }

  // ---------------- Enhanced lists ----------------

  /*
   * Every object of a kind, with the attributes `select` names, as one
   * list: paged from Unisphere 10.3 (`limit` and the resume token), in one
   * answer before. Stops at `maxItems`, and says so.
   */
  public async listEnhanced(data: {
    symmetrixId: string;
    objectType:
      | "storage-groups"
      | "volumes"
      | "directors"
      | "ports"
      | "rdf-groups";
    select: Array<string>;
    filter?: Array<string> | undefined;
    pageSize: number;
    maxItems: number;
  }): Promise<UnispherePage> {
    const canPage: boolean = this.getApiVersionNumber() >= 103;
    const base: string = `${UNISPHERE_ENHANCED_BASE}/systems/${encodeURIComponent(
      data.symmetrixId,
    )}/${data.objectType}`;
    const listKey: string = data.objectType.replace(/-/g, "_");

    const query: Record<string, string | number | undefined> = {
      select: data.select.join(","),
      filter:
        data.filter && data.filter.length ? data.filter.join(",") : undefined,
    };
    if (canPage) {
      query["limit"] = data.pageSize;
      query["expiration_delay_secs"] = 60;
    }

    const items: Array<JSONObject> = [];
    let total: number | null = null;
    let path: string = `${base}${toQueryString(query)}`;
    let pages: number = 0;

    for (;;) {
      pages++;
      const body: JSONObject = this.object(await this.get(path));
      const list: unknown =
        body[listKey] ||
        body["results"] ||
        Object.entries(body).find(([key, value]: [string, JSONValue]) => {
          return key !== "paging" && Array.isArray(value);
        })?.[1];

      for (const entry of Array.isArray(list) ? list : []) {
        if (isObject(entry)) {
          items.push(entry);
        }
      }

      const paging: JSONValue | undefined = body["paging"];
      if (isObject(paging)) {
        total = toNumber(paging["total_instances"]) ?? total;
      }

      if (items.length >= data.maxItems) {
        return {
          items: items.slice(0, data.maxItems),
          total: total ?? items.length,
          isTruncated: true,
        };
      }

      const resumeToken: string | null = isObject(paging)
        ? toText(paging["resume_token"])
        : null;
      const remaining: number | null = isObject(paging)
        ? toNumber(paging["remaining_instances"])
        : null;

      if (!canPage || !resumeToken || remaining === 0 || pages > 1000) {
        break;
      }

      const next: string | null = isObject(paging)
        ? toText(paging["next"])
        : null;
      if (next && next.startsWith("/rest/")) {
        path = `/univmax${next}`;
      } else if (next && next.startsWith("/univmax/")) {
        path = next;
      } else {
        path = `${base}${toQueryString({
          ...query,
          resume_token: resumeToken,
        })}`;
      }
    }

    return {
      items: items,
      total: Math.max(total ?? 0, items.length),
      isTruncated: false,
    };
  }

  private object(body: unknown): JSONObject {
    return isObject(body) ? (body as JSONObject) : {};
  }

  private textList(value: unknown): Array<string> {
    return (Array.isArray(value) ? value : [])
      .map((entry: unknown): string | null => {
        return toText(entry);
      })
      .filter((entry: string | null): entry is string => {
        return entry !== null;
      });
  }
}
