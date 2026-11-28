import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  CROWDSEC_DECISION_BAN,
  CROWDSEC_ONEUPTIME_ALERT_KIND,
  CROWDSEC_ONEUPTIME_ORIGIN,
  CROWDSEC_ONEUPTIME_SCENARIO,
  CROWDSEC_META_CONNECTION,
  CrowdSecScope,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import { lookupTable } from "../../../../Utils/LookupTable";
import { readCrowdSecMeta } from "../../../../Utils/SecurityEvent/Connectors/CrowdSecNormalizer";
import { AppVersion } from "../../../EnvironmentConfig";
import OutboundUserAgent, {
  OUTBOUND_USER_AGENT_PRODUCT,
} from "../../OutboundUserAgent";
import { ConnectorTransport } from "../Connectors/Types";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

/*
 * CROWDSEC'S LOCAL API (LAPI), AS ONE OF ITS MACHINES (#11158).
 *
 * What blocking through CrowdSec calls, built against CrowdSec v1.8.2
 * (pkg/models/localapi_swagger.yaml and pkg/apiserver behind it). A
 * machine - a watcher, in LAPI's words - is the only credential LAPI lets
 * add or delete decisions: a remediation component's API key (a bouncer's)
 * only reads them. So the connection holds a machine's ID and password,
 * made with `cscli machines add oneuptime --auto -f -`:
 *
 *   login           POST /v1/watchers/login {machine_id, password}: a JWT
 *                   for an hour, sent as a Bearer token. LAPI takes a
 *                   login only from a User-Agent of exactly one name and
 *                   one version ("OneUptime/18.0.0"): any other - the
 *                   product's usual "OneUptime/18.0.0 (+https://...)" - is
 *                   refused 401 as if the password were wrong
 *                   (middlewares/v1/jwt.go), so this client sends its own;
 *   readHealth      GET /health, which needs no login: whether LAPI is
 *                   there at all;
 *   listOwnBans     GET /v1/alerts?scenario=oneuptime/blocklist&origin=cscli
 *                   &has_active_decision=true&limit=0: every alert holding
 *                   one of OneUptime's bans still in force, of which only
 *                   this connection's (its alert meta names it) are kept.
 *                   A decision read back says how long it has left
 *                   ("23h59m58s"), and so when it ends;
 *   addBans         POST /v1/alerts: an alert per ban, as
 *                   `cscli decisions add` writes one (CrowdSecDecisions),
 *                   a hundred to a request - LAPI takes 50 MiB;
 *   deleteDecision  DELETE /v1/decisions/{id}: LAPI ends the decision at
 *                   once (it is expired, not deleted), and answers a
 *                   decision it no longer has with "doesn't exist" - gone
 *                   either way;
 *   readAllowlists  GET /v1/allowlists?with_content=true: the addresses and
 *                   ranges CrowdSec's own allowlists hold (LAPI 1.6.8 and
 *                   later; an older LAPI has none and answers 404).
 *
 * Every request goes through the connection's transport (the SSRF-guarded
 * DataSourceHttpFetch in production), and every message that leaves here
 * has the password and the token scrubbed out of it. Nothing here is ever
 * logged with either.
 */

// How many bans one POST /v1/alerts carries.
export const CROWDSEC_BANS_PER_REQUEST: number = 100;

// A decision LAPI's ExpireDecisionByID no longer finds ("decision with id '7' doesn't exist").
const GONE_DECISION_PATTERN: RegExp = /doesn'?t exist|not found/i;

// A decision's id, as LAPI numbers them.
const DECISION_ID_PATTERN: RegExp = /^\d+$/;

export interface CrowdSecLoginHints {
  password: string;
  validated: string;
  missing: string;
  method: string;
}

export const CROWDSEC_LOGIN_HINTS: Readonly<CrowdSecLoginHints> = {
  password:
    "Check the machine ID and password. `sudo cscli machines list` shows the machine; give it a new password with `sudo cscli machines add <machine ID> --force --auto -f -`.",
  validated:
    "Validate the machine on the CrowdSec host with `sudo cscli machines validate <machine ID>`.",
  missing:
    "LAPI has no machine of that ID. Add one on the CrowdSec host with `sudo cscli machines add oneuptime --auto -f -`.",
  method:
    "The machine signs in with a TLS certificate, not a password. Add one that signs in with a password: `sudo cscli machines add oneuptime --auto -f -`.",
};

// One of OneUptime's bans, as LAPI holds it.
export interface CrowdSecHeldDecision {
  // LAPI's id of the decision: what deleteDecision takes.
  id: string;
  alertId: string;
  type: string;
  scope: string;
  value: string;
  // What it had left when read: "23h59m58s".
  duration: string;
  // When it ends, worked out from that; null when LAPI gave no duration it could read.
  expiresAt: Date | null;
  // The alert's meta, by key.
  meta: Map<string, Array<string>>;
}

export interface CrowdSecBan {
  scope: CrowdSecScope;
  value: string;
  // How long the decision lasts from now, in whole seconds; at least one.
  durationInSeconds: number;
  // The alert's message: what `cscli alerts inspect` shows.
  message: string;
  // The alert's meta: the connection, the block, when it ends.
  meta: Array<{ key: string; value: string }>;
}

export interface CrowdSecBanBatchResult {
  bans: Array<CrowdSecBan>;
  isDone: boolean;
  // LAPI's ids of the alerts it made, in order, when it did.
  alertIds: Array<string>;
  error?: string | undefined;
}

export interface CrowdSecAllowlist {
  name: string;
  // The addresses and ranges it holds.
  values: Array<string>;
}

// The units of a Go duration, in milliseconds.
const GO_DURATION_UNITS: ReadonlyMap<string, number> = lookupTable<number>({
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
});

/*
 * A Go duration as LAPI writes one ("3h57m38s", "-1m2s", "0s", "1.5s"), in
 * milliseconds; null for what is none.
 */
export function parseGoDurationInMs(text: string): number | null {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "0") {
    return 0;
  }

  const match: RegExpMatchArray | null = trimmed.match(
    /^([+-])?((?:\d+(?:\.\d+)?(?:ns|us|µs|ms|h|m|s))+)$/,
  );

  if (!match || !match[2]) {
    return null;
  }

  let total: number = 0;

  for (const part of match[2].matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|h|m|s)/g)) {
    total += Number(part[1]) * (GO_DURATION_UNITS.get(part[2] || "") || 0);
  }

  return match[1] === "-" ? -total : total;
}

/*
 * The URL LAPI is reached at, as people paste it: the credentials file's
 * "http://127.0.0.1:8080/", with or without /v1. Refuses what would break
 * every call: no http(s), a query, a fragment, a user name in it.
 */
export function normalizeLapiUrl(raw: string): string {
  let parsed: URL;

  try {
    parsed = new URL((raw || "").trim());
  } catch {
    throw new BadDataException(
      "The Local API URL must be an address such as https://crowdsec.example.com:8080.",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadDataException("The Local API URL must use https or http.");
  }

  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new BadDataException(
      "The Local API URL must not hold a query, a fragment, a user name or a password.",
    );
  }

  const path: string = parsed.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");

  return `${parsed.origin}${path.replace(/\/+$/, "")}`;
}

/*
 * The User-Agent LAPI takes a login from: one name, one version, one slash
 * between them. OneUptime's version where it has one, filtered as every
 * outbound User-Agent's is.
 */
export function getCrowdSecUserAgent(version: string = AppVersion): string {
  const sanitized: string = OutboundUserAgent.sanitizeVersion(version);

  return `${OUTBOUND_USER_AGENT_PRODUCT}/${sanitized || "dev"}`;
}

function readMessage(result: ResponseHttpResult): string {
  const body: unknown = result.bodyJson;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const message: unknown = (body as JSONObject)["message"];

    if (typeof message === "string") {
      return message;
    }
  }

  return result.bodyText || "";
}

export default class CrowdSecLapiClient {
  private readonly baseUrl: string;
  private readonly machineId: string;
  private readonly password: string;
  private readonly transport: ConnectorTransport;
  private readonly userAgent: string;
  private token: string | null = null;

  public constructor(data: {
    lapiUrl: string;
    machineId: string;
    password: string;
    transport: ConnectorTransport;
    // For a test: what to sign in as.
    userAgent?: string | undefined;
  }) {
    this.baseUrl = normalizeLapiUrl(data.lapiUrl);
    this.machineId = data.machineId;
    this.password = data.password;
    this.transport = data.transport;
    this.userAgent = data.userAgent || getCrowdSecUserAgent();
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  // Whether LAPI answers at all, before any sign-in: its health endpoint.
  public async readHealth(): Promise<void> {
    const result: ResponseHttpResult = await this.send({
      method: "GET",
      path: "/health",
      step: "CrowdSec Local API health check",
      authenticated: false,
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure({
        step: "CrowdSec Local API health check",
        result,
      });
    }
  }

  public async login(): Promise<void> {
    const step: string = "CrowdSec Local API login";
    const result: ResponseHttpResult = await this.send({
      method: "POST",
      path: "/v1/watchers/login",
      body: JSON.stringify({
        machine_id: this.machineId,
        password: this.password,
      }),
      step,
      authenticated: false,
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure({ step, result, hint: this.loginHint(result) });
    }

    const token: unknown =
      result.bodyJson && typeof result.bodyJson === "object"
        ? (result.bodyJson as JSONObject)["token"]
        : undefined;

    if (typeof token !== "string" || !token) {
      throw new APIException(
        `${step} returned no token. A proxy in front of LAPI may be answering in its place.`,
      );
    }

    this.token = token;
  }

  /*
   * Every one of this connection's bans LAPI holds in force; with no
   * connection, every ban of OneUptime's there, whichever connection made it.
   */
  public async listOwnBans(
    connectionId: string | null,
    now: Date = new Date(),
  ): Promise<Array<CrowdSecHeldDecision>> {
    const step: string = "CrowdSec Local API alerts read";
    const query: string = new URLSearchParams({
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      origin: CROWDSEC_ONEUPTIME_ORIGIN,
      has_active_decision: "true",
      limit: "0",
    }).toString();

    const result: ResponseHttpResult = await this.sendAuthenticated({
      method: "GET",
      path: `/v1/alerts?${query}`,
      step,
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure({ step, result });
    }

    if (result.bodyJson !== null && !Array.isArray(result.bodyJson)) {
      throw new APIException(
        `${step} returned something other than a list of alerts.`,
      );
    }

    const held: Array<CrowdSecHeldDecision> = [];

    for (const item of (result.bodyJson as JSONArray | null) || []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const alert: JSONObject = item as JSONObject;
      const meta: Map<string, Array<string>> = readCrowdSecMeta(
        alert["meta"] as JSONValue,
      );

      const connections: Array<string> =
        meta.get(CROWDSEC_META_CONNECTION) || [];

      // Another connection's, another project's, or a person's: not this one's.
      if (
        connectionId === null
          ? connections.length === 0
          : !connections.includes(connectionId)
      ) {
        continue;
      }

      const decisions: JSONValue = alert["decisions"] as JSONValue;

      for (const decision of Array.isArray(decisions) ? decisions : []) {
        if (!decision || typeof decision !== "object") {
          continue;
        }

        const read: JSONObject = decision as JSONObject;

        if (
          String(read["scenario"] || "") !== CROWDSEC_ONEUPTIME_SCENARIO ||
          String(read["origin"] || "") !== CROWDSEC_ONEUPTIME_ORIGIN
        ) {
          continue;
        }

        const duration: string = String(read["duration"] || "");
        const left: number | null = parseGoDurationInMs(duration);

        // Ended already: LAPI keeps an expired decision until it flushes it.
        if (left !== null && left <= 0) {
          continue;
        }

        held.push({
          id: String(read["id"] ?? ""),
          alertId: String(alert["id"] ?? ""),
          type: String(read["type"] || ""),
          scope: String(read["scope"] || ""),
          value: String(read["value"] || ""),
          duration,
          expiresAt: left === null ? null : new Date(now.getTime() + left),
          meta,
        });
      }
    }

    return held;
  }

  // Each batch of bans, as LAPI took it or not.
  public async addBans(
    bans: Array<CrowdSecBan>,
    now: Date = new Date(),
  ): Promise<Array<CrowdSecBanBatchResult>> {
    const results: Array<CrowdSecBanBatchResult> = [];
    const at: string = now.toISOString().replace(/\.\d{3}Z$/, "Z");

    for (
      let index: number = 0;
      index < bans.length;
      index += CROWDSEC_BANS_PER_REQUEST
    ) {
      const batch: Array<CrowdSecBan> = bans.slice(
        index,
        index + CROWDSEC_BANS_PER_REQUEST,
      );
      const step: string = "CrowdSec Local API ban";

      try {
        const result: ResponseHttpResult = await this.sendAuthenticated({
          method: "POST",
          path: "/v1/alerts",
          body: JSON.stringify(
            batch.map((ban: CrowdSecBan): JSONObject => {
              return CrowdSecLapiClient.toAlert(ban, at);
            }),
          ),
          step,
        });

        if (!ResponseHttp.isSuccess(result)) {
          results.push({
            bans: batch,
            isDone: false,
            alertIds: [],
            error: this.failure({ step, result }).message,
          });
          continue;
        }

        results.push({
          bans: batch,
          isDone: true,
          alertIds: Array.isArray(result.bodyJson)
            ? (result.bodyJson as JSONArray).map((id: JSONValue): string => {
                return String(id);
              })
            : [],
        });
      } catch (error) {
        results.push({
          bans: batch,
          isDone: false,
          alertIds: [],
          error: this.scrub(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }

    return results;
  }

  // Ends one decision. Done when LAPI ended it, or no longer has it.
  public async deleteDecision(id: string): Promise<void> {
    const step: string = "CrowdSec Local API decision delete";

    if (!DECISION_ID_PATTERN.test(id)) {
      throw new APIException(
        `${step}: OneUptime does not know which CrowdSec decision holds it.`,
      );
    }

    const result: ResponseHttpResult = await this.sendAuthenticated({
      method: "DELETE",
      path: `/v1/decisions/${id}`,
      step,
    });

    if (ResponseHttp.isSuccess(result)) {
      return;
    }

    if (
      (result.statusCode === 404 || result.statusCode === 500) &&
      GONE_DECISION_PATTERN.test(readMessage(result))
    ) {
      return;
    }

    throw this.failure({ step, result });
  }

  /*
   * CrowdSec's own allowlists, with what each holds. None from a LAPI
   * older than allowlists (1.6.8), which knows no such path.
   */
  public async readAllowlists(): Promise<Array<CrowdSecAllowlist>> {
    const step: string = "CrowdSec Local API allowlists read";
    const result: ResponseHttpResult = await this.sendAuthenticated({
      method: "GET",
      path: "/v1/allowlists?with_content=true",
      step,
    });

    if (result.statusCode === 404 || result.statusCode === 405) {
      return [];
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure({ step, result });
    }

    const lists: Array<CrowdSecAllowlist> = [];

    for (const item of Array.isArray(result.bodyJson)
      ? (result.bodyJson as JSONArray)
      : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const list: JSONObject = item as JSONObject;
      const items: JSONValue = list["items"] as JSONValue;

      lists.push({
        name: String(list["name"] || ""),
        values: (Array.isArray(items) ? items : [])
          .map((entry: JSONValue): string => {
            return entry && typeof entry === "object" && !Array.isArray(entry)
              ? String((entry as JSONObject)["value"] || "").trim()
              : "";
          })
          .filter(Boolean),
      });
    }

    return lists;
  }

  // A ban, as the alert LAPI is sent: as `cscli decisions add` writes one.
  public static toAlert(ban: CrowdSecBan, at: string): JSONObject {
    const duration: string = `${Math.max(1, Math.ceil(ban.durationInSeconds))}s`;

    return {
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      scenario_hash: "",
      scenario_version: "",
      message: ban.message,
      events_count: 1,
      events: [],
      start_at: at,
      stop_at: at,
      capacity: 0,
      leakspeed: "0",
      simulated: false,
      remediation: true,
      kind: CROWDSEC_ONEUPTIME_ALERT_KIND,
      source:
        ban.scope === CrowdSecScope.Range
          ? { scope: CrowdSecScope.Range, value: ban.value, range: ban.value }
          : { scope: CrowdSecScope.Ip, value: ban.value, ip: ban.value },
      decisions: [
        {
          duration,
          origin: CROWDSEC_ONEUPTIME_ORIGIN,
          scenario: CROWDSEC_ONEUPTIME_SCENARIO,
          scope: ban.scope,
          type: CROWDSEC_DECISION_BAN,
          value: ban.value,
        },
      ],
      meta: ban.meta.map((item: { key: string; value: string }): JSONObject => {
        return { key: item.key, value: item.value };
      }),
    };
  }

  private loginHint(result: ResponseHttpResult): string {
    const message: string = readMessage(result).toLowerCase();

    if (message.includes("not validated")) {
      return CROWDSEC_LOGIN_HINTS.validated;
    }

    if (message.includes("not found")) {
      return CROWDSEC_LOGIN_HINTS.missing;
    }

    if (message.includes("configured to use")) {
      return CROWDSEC_LOGIN_HINTS.method;
    }

    return CROWDSEC_LOGIN_HINTS.password;
  }

  private async sendAuthenticated(data: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: string | undefined;
    step: string;
  }): Promise<ResponseHttpResult> {
    if (!this.token) {
      await this.login();
    }

    const result: ResponseHttpResult = await this.send({
      ...data,
      authenticated: true,
    });

    // A token that lapsed mid-pass (LAPI's last an hour): once more, signed in again.
    if (result.statusCode === 401) {
      this.token = null;
      await this.login();

      return await this.send({ ...data, authenticated: true });
    }

    return result;
  }

  private async send(data: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: string | undefined;
    step: string;
    authenticated: boolean;
  }): Promise<ResponseHttpResult> {
    const headers: Dictionary<string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };

    if (data.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (data.authenticated && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: data.method,
        url: `${this.baseUrl}${data.path}`,
        headers,
        ...(data.body !== undefined ? { body: data.body } : {}),
        acceptAnyStatus: true,
      },
      step: data.step,
      secrets: this.secrets(),
    });
  }

  private failure(data: {
    step: string;
    result: ResponseHttpResult;
    hint?: string | undefined;
  }): APIException {
    return ResponseHttp.failure({
      step: data.step,
      result: data.result,
      secrets: this.secrets(),
      hint: data.hint,
    });
  }

  private scrub(text: string): string {
    let scrubbed: string = text;

    for (const secret of this.secrets()) {
      scrubbed = scrubbed.split(secret).join("[REDACTED]");
    }

    return scrubbed;
  }

  private secrets(): Array<string> {
    return [this.password, this.token || ""].filter((secret: string) => {
      return secret.length >= 4;
    });
  }
}
