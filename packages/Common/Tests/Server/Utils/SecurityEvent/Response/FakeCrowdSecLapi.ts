import http from "http";
import { AddressInfo } from "net";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
  getDataSourceHttpStatusError,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * A CROWDSEC LOCAL API, AS v1.8.2 ANSWERS (#11158).
 *
 * A real HTTP server on 127.0.0.1, answering the calls OneUptime makes the
 * way CrowdSec's own handlers do - read from its source at v1.8.2
 * (pkg/apiserver/controllers/v1, middlewares/v1/jwt.go, pkg/database) - so
 * what the client sends goes over the wire and what it reads comes back as
 * LAPI writes it:
 *
 *   GET /health                {"status":"up"}, without a sign-in;
 *   POST /v1/watchers/login    the JWT middleware's Authenticator: the
 *                              machine must exist, sign in with a password,
 *                              be validated and give the right one - and
 *                              the request's User-Agent must be exactly one
 *                              name and one version ("a/b"), or the login
 *                              is refused as a wrong password is (401,
 *                              "incorrect Username or Password");
 *   POST /v1/alerts            CreateAlert: an alert with decisions keeps
 *                              them (cscli's way); each decision ends at the
 *                              alert's stop_at plus its duration
 *                              (ParseDurationWithDays); one whose value is
 *                              no address or range is dropped silently, as
 *                              createDecisionBatch drops it; answers 201
 *                              with the alerts' ids. Every alert is handed
 *                              to the profiles, so a test can see what a
 *                              notification plugin would be sent;
 *   GET /v1/alerts             QueryAlertWithFilter and alertfilter.go:
 *                              scenario (the alert's or a decision's),
 *                              origin, has_active_decision, scope, value,
 *                              ip, since and until (durations), limit (100
 *                              by default, 0 for all), sort; any other
 *                              parameter refused 500 as an unknown filter.
 *                              Each alert as FormatOneAlert writes it: a
 *                              decision's duration is what it has left
 *                              ("3h59m49s", "-1m2s" once ended), an
 *                              event's time Go's String();
 *   DELETE /v1/decisions/:id   DeleteDecisionById: ends it now (it is
 *                              expired, not deleted); an id it does not
 *                              have is a 500 "decision with id '7' doesn't
 *                              exist"; one that is no integer a 400;
 *   GET /v1/allowlists         GetAllowlists with with_content: each list's
 *                              items still in force. A LAPI older than
 *                              1.6.8 knows no such path: 404.
 *
 * A route it has no handler for is gin's 404 "404 page not found". The
 * clock is the test's (setNow), and ids and tokens count up, so every run
 * is the same.
 */

export interface FakeLapiMachine {
  password: string;
  isValidated?: boolean | undefined;
  authType?: "password" | "tls" | undefined;
}

export interface FakeLapiDecision {
  id: number;
  origin: string;
  type: string;
  scope: string;
  value: string;
  scenario: string;
  until: Date;
  simulated: boolean;
}

export interface FakeLapiAlert {
  id: number;
  uuid: string;
  machineId: string;
  createdAt: Date;
  scenario: string;
  scenarioHash: string;
  scenarioVersion: string;
  message: string;
  eventsCount: number;
  startedAt: Date;
  stoppedAt: Date;
  capacity: number;
  leakSpeed: string;
  simulated: boolean;
  remediation: boolean;
  kind: string;
  source: JSONObject;
  meta: Array<{ key: string; value: string }>;
  events: Array<{ time: Date; meta: JSONArray }>;
  decisions: Array<FakeLapiDecision>;
}

export interface FakeLapiRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// Go's time.Time.String(), for a time in UTC: "2022-02-12 14:10:23 +0000 UTC".
export function goTimeString(time: Date): string {
  const iso: string = time.toISOString();
  const millis: string = iso.slice(20, 23).replace(/0+$/, "");

  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${millis ? `.${millis}` : ""} +0000 UTC`;
}

// Go's time.Duration.String(), rounded to the second as LAPI rounds it.
export function goDurationString(ms: number): string {
  const totalSeconds: number = Math.round(ms / 1000);

  if (totalSeconds === 0) {
    return "0s";
  }

  const sign: string = totalSeconds < 0 ? "-" : "";
  let seconds: number = Math.abs(totalSeconds);
  const hours: number = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes: number = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  if (hours > 0) {
    return `${sign}${hours}h${minutes}m${seconds}s`;
  }

  if (minutes > 0) {
    return `${sign}${minutes}m${seconds}s`;
  }

  return `${sign}${seconds}s`;
}

// cstime.ParseDurationWithDays: Go's durations, and "d" for days.
export function parseLapiDuration(text: string): number | null {
  const match: RegExpMatchArray | null = (text || "").match(
    /^(-?)((?:\d+(?:\.\d+)?(?:ns|us|µs|ms|d|h|m|s))+)$/,
  );

  if (!match || !match[2]) {
    return null;
  }

  const units: Map<string, number> = new Map([
    ["ns", 1e-6],
    ["us", 1e-3],
    ["µs", 1e-3],
    ["ms", 1],
    ["s", 1000],
    ["m", 60000],
    ["h", 3600000],
    ["d", 86400000],
  ]);
  let total: number = 0;

  for (const part of match[2].matchAll(
    /(\d+(?:\.\d+)?)(ns|us|µs|ms|d|h|m|s)/g,
  )) {
    total += Number(part[1]) * (units.get(part[2] || "") || 0);
  }

  return match[1] === "-" ? -total : total;
}

function json(
  response: http.ServerResponse,
  status: number,
  body: JSONValue,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function notFound(response: http.ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("404 page not found");
}

// A decision's id, as LAPI numbers them.
const DECISION_ID_PATTERN: RegExp = /^\d+$/;

const REQUIRED_ALERT_FIELDS: ReadonlyArray<string> = [
  "scenario",
  "scenario_hash",
  "scenario_version",
  "message",
  "events_count",
  "start_at",
  "stop_at",
  "capacity",
  "leakspeed",
  "simulated",
  "events",
  "source",
];

const REQUIRED_DECISION_FIELDS: ReadonlyArray<string> = [
  "origin",
  "type",
  "scope",
  "value",
  "duration",
  "scenario",
];

const KNOWN_ALERT_FILTERS: ReadonlyArray<string> = [
  "contains",
  "scope",
  "value",
  "scenario",
  "ip",
  "range",
  "since",
  "created_before",
  "until",
  "decision_type",
  "origin",
  "include_capi",
  "has_active_decision",
  "kind",
  "limit",
  "sort",
  "simulated",
  "with_decisions",
];

export default class FakeCrowdSecLapi {
  public readonly machines: Map<string, FakeLapiMachine> = new Map();
  public readonly alerts: Array<FakeLapiAlert> = [];
  public readonly requests: Array<FakeLapiRequest> = [];
  // The alerts the profiles were handed, as a notification plugin would be sent them.
  public readonly notified: Array<JSONObject> = [];
  public allowlists: Array<{
    name: string;
    items: Array<{ value: string; expiration?: Date | undefined }>;
  }> = [];
  // An older LAPI: no allowlists (before 1.6.8).
  public hasAllowlists: boolean = true;
  // Answer every request with this status, as a LAPI behind a broken proxy would.
  public failEveryRequestWith: number | null = null;

  private server: http.Server | null = null;
  private now: Date = new Date("2026-11-28T10:00:00.000Z");
  private nextAlertId: number = 1;
  private nextDecisionId: number = 1;
  private nextToken: number = 1;
  private readonly tokens: Map<string, { machineId: string; expiresAt: Date }> =
    new Map();

  public setNow(now: Date): void {
    this.now = now;
  }

  public getNow(): Date {
    return this.now;
  }

  public addMachine(id: string, machine: FakeLapiMachine): void {
    this.machines.set(id, machine);
  }

  public async start(): Promise<string> {
    this.server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        const chunks: Array<Buffer> = [];

        request.on("data", (chunk: Buffer): void => {
          chunks.push(chunk);
        });

        request.on("end", (): void => {
          const body: string = Buffer.concat(chunks).toString("utf8");

          this.requests.push({
            method: request.method || "",
            path: request.url || "",
            headers: request.headers,
            body,
          });

          try {
            this.handle(request, body, response);
          } catch (error) {
            json(response, 500, { message: String(error) });
          }
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    const address: AddressInfo = this.server.address() as AddressInfo;

    return `http://127.0.0.1:${address.port}`;
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve: () => void): void => {
      this.server!.close((): void => {
        resolve();
      });
    });

    this.server = null;
  }

  // What LAPI holds in force now, as `cscli decisions list` lists it.
  public activeDecisions(): Array<FakeLapiDecision & { alert: FakeLapiAlert }> {
    const active: Array<FakeLapiDecision & { alert: FakeLapiAlert }> = [];

    for (const alert of this.alerts) {
      for (const decision of alert.decisions) {
        if (decision.until.getTime() > this.now.getTime()) {
          active.push({ ...decision, alert });
        }
      }
    }

    return active;
  }

  // A decision a person makes with `cscli decisions add`, or CrowdSec with a scenario's.
  public addDecisionAlert(data: {
    machineId: string;
    scenario: string;
    origin: string;
    value: string;
    scope?: string | undefined;
    durationInMs: number;
    meta?: Array<{ key: string; value: string }> | undefined;
  }): FakeLapiAlert {
    const alert: FakeLapiAlert = this.newAlert({
      machineId: data.machineId,
      scenario: data.scenario,
      message: data.scenario,
      stoppedAt: this.now,
      source: { scope: data.scope || "Ip", value: data.value, ip: data.value },
      meta: data.meta || [],
    });

    alert.decisions.push({
      id: this.nextDecisionId++,
      origin: data.origin,
      type: "ban",
      scope: data.scope || "Ip",
      value: data.value,
      scenario: data.scenario,
      until: new Date(this.now.getTime() + data.durationInMs),
      simulated: false,
    });

    this.alerts.push(alert);
    return alert;
  }

  // What LAPI's flush did before 1.8: an alert older than max_age deleted, its decisions with it.
  public flushOlderThan(ms: number): number {
    const before: number = this.alerts.length;
    const kept: Array<FakeLapiAlert> = this.alerts.filter(
      (alert: FakeLapiAlert): boolean => {
        return alert.createdAt.getTime() > this.now.getTime() - ms;
      },
    );

    this.alerts.length = 0;
    this.alerts.push(...kept);

    return before - kept.length;
  }

  // A test's way to end every token, as an hour passing would.
  public expireTokens(): void {
    this.tokens.clear();
  }

  private newAlert(data: {
    machineId: string;
    scenario: string;
    message: string;
    stoppedAt: Date;
    source: JSONObject;
    meta: Array<{ key: string; value: string }>;
  }): FakeLapiAlert {
    const id: number = this.nextAlertId++;

    return {
      id,
      uuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      machineId: data.machineId,
      createdAt: this.now,
      scenario: data.scenario,
      scenarioHash: "",
      scenarioVersion: "",
      message: data.message,
      eventsCount: 1,
      startedAt: data.stoppedAt,
      stoppedAt: data.stoppedAt,
      capacity: 0,
      leakSpeed: "0",
      simulated: false,
      remediation: true,
      kind: "cscli",
      source: data.source,
      meta: data.meta,
      events: [],
      decisions: [],
    };
  }

  private handle(
    request: http.IncomingMessage,
    body: string,
    response: http.ServerResponse,
  ): void {
    const url: URL = new URL(request.url || "/", "http://lapi");
    const method: string = request.method || "GET";

    if (this.failEveryRequestWith) {
      json(response, this.failEveryRequestWith, { message: "proxy error" });
      return;
    }

    if (url.pathname === "/health" && method === "GET") {
      json(response, 200, { status: "up" });
      return;
    }

    if (url.pathname === "/v1/watchers/login" && method === "POST") {
      this.login(request, body, response);
      return;
    }

    const isAlerts: boolean = url.pathname === "/v1/alerts";
    const decisionMatch: RegExpMatchArray | null = url.pathname.match(
      /^\/v1\/decisions\/([^/]+)$/,
    );
    const isAllowlists: boolean =
      url.pathname === "/v1/allowlists" && this.hasAllowlists;

    if (!isAlerts && !decisionMatch && !isAllowlists) {
      notFound(response);
      return;
    }

    const machineId: string | null = this.authenticate(request, response);

    if (!machineId) {
      return;
    }

    if (isAlerts && method === "POST") {
      this.createAlerts(machineId, body, response);
      return;
    }

    if (isAlerts && method === "GET") {
      this.findAlerts(url, response);
      return;
    }

    if (decisionMatch && method === "DELETE") {
      this.deleteDecision(decisionMatch[1] || "", response);
      return;
    }

    if (isAllowlists && method === "GET") {
      this.getAllowlists(url, response);
      return;
    }

    json(response, 405, { message: "405 method not allowed" });
  }

  private login(
    request: http.IncomingMessage,
    body: string,
    response: http.ServerResponse,
  ): void {
    let input: JSONObject;

    try {
      input = JSON.parse(body) as JSONObject;
    } catch (error) {
      json(response, 401, { code: 401, message: `missing: ${String(error)}` });
      return;
    }

    const machineId: unknown = input["machine_id"];
    const password: unknown = input["password"];

    if (typeof machineId !== "string" || typeof password !== "string") {
      json(response, 401, {
        code: 401,
        message: "validation failure list:\nmachine_id in body is required",
      });
      return;
    }

    const machine: FakeLapiMachine | undefined = this.machines.get(machineId);

    if (!machine) {
      json(response, 401, { code: 401, message: "ent: machine not found" });
      return;
    }

    if ((machine.authType || "password") !== "password") {
      json(response, 401, {
        code: 401,
        message: `machine ${machineId} attempted to auth with password but it is configured to use ${machine.authType}`,
      });
      return;
    }

    if (machine.isValidated === false) {
      json(response, 401, {
        code: 401,
        message: `machine ${machineId} not validated`,
      });
      return;
    }

    if (machine.password !== password) {
      json(response, 401, {
        code: 401,
        message: "incorrect Username or Password",
      });
      return;
    }

    // jwt.go: `strings.Split(c.Request.UserAgent(), "/")` must give two parts.
    if (String(request.headers["user-agent"] || "").split("/").length !== 2) {
      json(response, 401, {
        code: 401,
        message: "incorrect Username or Password",
      });
      return;
    }

    const token: string = `fake-jwt-${this.nextToken++}`;
    const expiresAt: Date = new Date(this.now.getTime() + 60 * 60 * 1000);

    this.tokens.set(token, { machineId, expiresAt });
    json(response, 200, {
      code: 200,
      expire: expiresAt.toISOString(),
      token,
    });
  }

  private authenticate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): string | null {
    const header: string = String(request.headers["authorization"] || "");

    if (!header) {
      json(response, 401, { code: 401, message: "cookie token is empty" });
      return null;
    }

    const token: string = header.replace(/^Bearer /, "");
    const held: { machineId: string; expiresAt: Date } | undefined =
      this.tokens.get(token);

    if (!held || held.expiresAt.getTime() <= this.now.getTime()) {
      json(response, 401, { code: 401, message: "Token is expired" });
      return null;
    }

    return held.machineId;
  }

  private createAlerts(
    machineId: string,
    body: string,
    response: http.ServerResponse,
  ): void {
    let input: unknown;

    try {
      input = JSON.parse(body);
    } catch (error) {
      json(response, 400, { message: String(error) });
      return;
    }

    if (!Array.isArray(input)) {
      json(response, 400, {
        message:
          "json: cannot unmarshal object into Go value of type models.AddAlertsRequest",
      });
      return;
    }

    // input.Validate: every required field of every alert and decision, or nothing is made.
    for (const [index, item] of input.entries()) {
      const alert: JSONObject = (item || {}) as JSONObject;

      for (const field of REQUIRED_ALERT_FIELDS) {
        if (alert[field] === undefined || alert[field] === null) {
          json(response, 500, {
            message: `validation failure list:\n${index}.${field} in body is required`,
          });
          return;
        }
      }

      const source: JSONObject = alert["source"] as JSONObject;

      if (!source["scope"] || source["value"] === undefined) {
        json(response, 500, {
          message: `validation failure list:\n${index}.source.scope in body is required`,
        });
        return;
      }

      for (const decision of (alert["decisions"] as JSONArray | undefined) ||
        []) {
        for (const field of REQUIRED_DECISION_FIELDS) {
          if ((decision as JSONObject)[field] === undefined) {
            json(response, 500, {
              message: `validation failure list:\n${index}.decisions.${field} in body is required`,
            });
            return;
          }
        }
      }
    }

    const ids: Array<string> = [];

    for (const item of input as Array<JSONObject>) {
      const stoppedAt: Date = new Date(String(item["stop_at"]));
      const alert: FakeLapiAlert = this.newAlert({
        machineId,
        scenario: String(item["scenario"]),
        message: String(item["message"]),
        stoppedAt: Number.isNaN(stoppedAt.getTime()) ? this.now : stoppedAt,
        source: item["source"] as JSONObject,
        meta: ((item["meta"] as JSONArray | undefined) || []).map(
          (entry: JSONValue): { key: string; value: string } => {
            return {
              key: String((entry as JSONObject)["key"]),
              value: String((entry as JSONObject)["value"]).slice(0, 4095),
            };
          },
        ),
      });

      alert.kind = String(item["kind"] || "");
      alert.remediation = item["remediation"] === true;
      alert.simulated = item["simulated"] === true;

      for (const decision of (item["decisions"] as JSONArray | undefined) ||
        []) {
        const read: JSONObject = decision as JSONObject;
        const duration: number | null = parseLapiDuration(
          String(read["duration"]),
        );

        if (duration === null) {
          json(response, 500, {
            message: `decision duration '${String(read["duration"])}': time: invalid duration: unable to parse duration`,
          });
          return;
        }

        const scope: string = String(read["scope"]).toLowerCase();
        const value: string = String(read["value"]);

        // createDecisionBatch: an address or range that does not parse is dropped, the alert kept.
        if (
          (scope === "ip" || scope === "range") &&
          !NetworkAddressBlockUtil.parse(value)
        ) {
          continue;
        }

        alert.decisions.push({
          id: this.nextDecisionId++,
          origin: String(read["origin"]),
          type: String(read["type"]),
          scope:
            scope === "ip"
              ? "Ip"
              : scope === "range"
                ? "Range"
                : String(read["scope"]),
          value,
          scenario: String(read["scenario"]),
          until: new Date(alert.stoppedAt.getTime() + duration),
          simulated: alert.simulated,
        });
      }

      this.alerts.push(alert);
      this.notified.push(this.format(alert));
      ids.push(String(alert.id));
    }

    json(response, 201, ids);
  }

  private findAlerts(url: URL, response: http.ServerResponse): void {
    for (const key of url.searchParams.keys()) {
      if (!KNOWN_ALERT_FILTERS.includes(key)) {
        json(response, 500, {
          message: `filter parameter '${key}' is unknown (=${url.searchParams.get(key)}): invalid filter`,
        });
        return;
      }
    }

    const scenario: string | null = url.searchParams.get("scenario");
    const origin: string | null = url.searchParams.get("origin");
    const hasActive: string | null = url.searchParams.get(
      "has_active_decision",
    );
    const value: string | null = url.searchParams.get("value");
    const ip: string | null = url.searchParams.get("ip");
    const limitText: string | null = url.searchParams.get("limit");
    const sort: string =
      url.searchParams.get("sort") === "ASC" ? "ASC" : "DESC";
    const limit: number = limitText === null ? 100 : Number(limitText);

    let found: Array<FakeLapiAlert> = this.alerts.filter(
      (alert: FakeLapiAlert): boolean => {
        if (
          scenario !== null &&
          alert.scenario !== scenario &&
          !alert.decisions.some((decision: FakeLapiDecision): boolean => {
            return decision.scenario === scenario;
          })
        ) {
          return false;
        }

        if (
          origin !== null &&
          !alert.decisions.some((decision: FakeLapiDecision): boolean => {
            return decision.origin === origin;
          })
        ) {
          return false;
        }

        if (hasActive === "true") {
          if (
            !alert.decisions.some((decision: FakeLapiDecision): boolean => {
              return decision.until.getTime() >= this.now.getTime();
            })
          ) {
            return false;
          }
        } else if (hasActive === "false" && alert.decisions.length > 0) {
          return false;
        }

        if (value !== null && String(alert.source["value"]) !== value) {
          return false;
        }

        if (ip !== null) {
          const block: NetworkAddressBlock | null =
            NetworkAddressBlockUtil.parse(ip);

          if (
            !block ||
            !alert.decisions.some((decision: FakeLapiDecision): boolean => {
              const held: NetworkAddressBlock | null =
                NetworkAddressBlockUtil.parse(decision.value);

              return Boolean(
                held && NetworkAddressBlockUtil.overlaps(held, block),
              );
            })
          ) {
            return false;
          }
        }

        return true;
      },
    );

    found = found.sort((left: FakeLapiAlert, right: FakeLapiAlert): number => {
      const order: number =
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id - right.id;

      return sort === "ASC" ? order : -order;
    });

    if (limit > 0) {
      found = found.slice(0, limit);
    }

    json(
      response,
      200,
      found.map((alert: FakeLapiAlert): JSONObject => {
        return this.format(alert);
      }),
    );
  }

  private deleteDecision(id: string, response: http.ServerResponse): void {
    if (!DECISION_ID_PATTERN.test(id)) {
      json(response, 400, { message: "decision_id must be valid integer" });
      return;
    }

    for (const alert of this.alerts) {
      for (const decision of alert.decisions) {
        if (decision.id === Number(id)) {
          decision.until = this.now;
          json(response, 200, { nbDeleted: "1" });
          return;
        }
      }
    }

    json(response, 500, {
      message: `decision with id '${id}' doesn't exist: unable to delete`,
    });
  }

  private getAllowlists(url: URL, response: http.ServerResponse): void {
    const withContent: boolean =
      url.searchParams.get("with_content") === "true";

    json(
      response,
      200,
      this.allowlists.map(
        (
          list: {
            name: string;
            items: Array<{ value: string; expiration?: Date | undefined }>;
          },
          index: number,
        ): JSONObject => {
          return {
            allowlist_id: `allowlist-${index + 1}`,
            name: list.name,
            description: "",
            console_managed: false,
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            items: withContent
              ? list.items
                  .filter(
                    (item: {
                      value: string;
                      expiration?: Date | undefined;
                    }): boolean => {
                      return (
                        !item.expiration ||
                        item.expiration.getTime() > this.now.getTime()
                      );
                    },
                  )
                  .map(
                    (item: {
                      value: string;
                      expiration?: Date | undefined;
                    }): JSONObject => {
                      return {
                        value: item.value,
                        description: "",
                        created_at: "2026-11-01T00:00:00.000Z",
                        expiration: (
                          item.expiration ||
                          new Date("0001-01-01T00:00:00.000Z")
                        ).toISOString(),
                      };
                    },
                  )
              : [],
          };
        },
      ),
    );
  }

  // An alert as FormatOneAlert writes it.
  private format(alert: FakeLapiAlert): JSONObject {
    return {
      id: alert.id,
      uuid: alert.uuid,
      machine_id: alert.machineId,
      created_at: alert.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      scenario: alert.scenario,
      scenario_hash: alert.scenarioHash,
      scenario_version: alert.scenarioVersion,
      message: alert.message,
      events_count: alert.eventsCount,
      start_at: alert.startedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      stop_at: alert.stoppedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      capacity: alert.capacity,
      leakspeed: alert.leakSpeed,
      simulated: alert.simulated,
      remediation: alert.remediation,
      kind: alert.kind,
      source: alert.source,
      events: alert.events.map(
        (event: { time: Date; meta: JSONArray }): JSONObject => {
          return { timestamp: goTimeString(event.time), meta: event.meta };
        },
      ),
      meta: alert.meta.map(
        (item: { key: string; value: string }): JSONObject => {
          return { key: item.key, value: item.value };
        },
      ),
      decisions: alert.decisions.map(
        (decision: FakeLapiDecision): JSONObject => {
          return {
            duration: goDurationString(
              decision.until.getTime() - this.now.getTime(),
            ),
            scenario: decision.scenario,
            type: decision.type,
            scope: decision.scope,
            value: decision.value,
            origin: decision.origin,
            simulated: decision.simulated,
            id: decision.id,
          };
        },
      ),
    };
  }
}

/*
 * The transport the tests reach the fake LAPI through: plain HTTP on
 * 127.0.0.1, answered as DataSourceHttpFetch answers - every status when
 * asked, otherwise a throw for one outside 2xx. (DataSourceHttpFetch itself
 * never dials loopback.)
 */
export async function loopbackTransport(
  request: DataSourceHttpRequest,
): Promise<DataSourceHttpResponse> {
  const target: URL = new URL(request.url);
  const body: string | undefined =
    typeof request.body === "string"
      ? request.body
      : request.body === undefined
        ? undefined
        : JSON.stringify(request.body);

  /*
   * Node's http, as DataSourceHttpFetch's: Common's tests run in jsdom,
   * whose XMLHttpRequest (axios's browser build there) they refuse.
   */
  const { status, bodyText } = await new Promise<{
    status: number;
    bodyText: string;
  }>(
    (
      resolve: (value: { status: number; bodyText: string }) => void,
      reject: (error: Error) => void,
    ): void => {
      const outgoing: http.ClientRequest = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: request.method,
          headers: request.headers || {},
        },
        (incoming: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];

          incoming.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          incoming.on("end", (): void => {
            resolve({
              status: incoming.statusCode || 0,
              bodyText: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      outgoing.on("error", reject);

      if (body !== undefined) {
        outgoing.write(body);
      }

      outgoing.end();
    },
  );

  const response: { status: number } = { status };

  if (!request.acceptAnyStatus && response.status >= 300) {
    throw getDataSourceHttpStatusError(response.status, bodyText);
  }

  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: response.status, bodyText, bodyJson };
}
