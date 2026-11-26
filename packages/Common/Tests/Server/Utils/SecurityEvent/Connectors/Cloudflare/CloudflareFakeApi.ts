import Dictionary from "../../../../../../Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "../../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Cloudflare's API as the connector meets it, answering the way Cloudflare
 * answers (the v4 envelope on REST, { data, errors } on GraphQL, a 200 that
 * holds errors, a 429 with Retry-After), recorded from its documentation:
 *
 *   GET  /client/v4/user/tokens/verify
 *   GET  /client/v4/accounts/{id}/tokens/verify
 *   GET  /client/v4/zones?account.id=&page=&per_page=
 *   POST /client/v4/graphql   (the settings node, firewallEventsAdaptive
 *                              with its filter and sort, and the grouped
 *                              counts of firewallEventsAdaptiveGroups)
 *
 * The events are filtered and sorted as Cloudflare documents - by datetime,
 * then Ray ID, then match index, with datetime_geq, datetime_lt and an OR of
 * the keys after the last row - so a page after the first is exactly what
 * the API would return.
 */

export const TOKEN: string = "Cf9nRk2Lq7Vx4Tb8Zw1Hy6Jm3Pd5Sg0Ua_-Ee7Wo2";
export const ACCOUNT_ID: string = "9a7806061c88ada191ed06f989cc3dac";
export const OTHER_ACCOUNT_ID: string = "1b2c3d4e5f60718293a4b5c6d7e8f901";
export const ZONE_A: string = "023e105f4ecef8ad9ca31a8372d0c353";
export const ZONE_B: string = "353c0d2738a13ac9da8fece4f501e320";
export const ZONE_OTHER: string = "aaaabbbbccccddddeeeeffff00001111";

export interface FakeZone {
  id: string;
  name: string;
  status?: string;
  accountId?: string;
  accountName?: string;
  plan?: { name: string; legacy_id: string };
  // Whether the token has Analytics Read here.
  analytics?: boolean;
  settings?: JSONObject | null;
  events?: Array<JSONObject>;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Dictionary<string>;
  operation: string;
  variables: JSONObject;
  queryText: string;
  headers: Dictionary<string>;
}

// An answer to send instead of the usual one, for the request it matches.
export interface ScriptedAnswer {
  matches: (request: FakeRequest) => boolean;
  response: DataSourceHttpResponse;
  // How many times it answers before the usual one answers again.
  times: number;
}

export function json(
  statusCode: number,
  body: JSONValue,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  const text: string = JSON.stringify(body);

  return {
    statusCode,
    bodyText: text,
    bodyJson: JSON.parse(text),
    headers: { "content-type": "application/json", ...headers },
  };
}

export function restError(
  statusCode: number,
  code: number,
  message: string,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  return json(
    statusCode,
    {
      success: false,
      errors: [{ code, message }],
      messages: [],
      result: null,
    },
    headers,
  );
}

export function graphQlError(
  message: string,
  statusCode: number = 200,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  return json(
    statusCode,
    {
      data: null,
      errors: [
        {
          message,
          path: ["viewer", "zones", "0"],
          extensions: { timestamp: "2026-11-20T10:45:00Z" },
        },
      ],
    },
    headers,
  );
}

function readFilterTime(value: JSONValue | undefined): number {
  return typeof value === "string" ? new Date(value).getTime() : Number.NaN;
}

function compareRows(a: JSONObject, b: JSONObject): number {
  const timeA: number = new Date(String(a["datetime"])).getTime();
  const timeB: number = new Date(String(b["datetime"])).getTime();

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  const rayA: string = String(a["rayName"]);
  const rayB: string = String(b["rayName"]);

  if (rayA !== rayB) {
    return rayA < rayB ? -1 : 1;
  }

  return Number(a["matchIndex"]) - Number(b["matchIndex"]);
}

// Whether a row passes one filter object, as Cloudflare reads its keys (all must hold).
function passes(row: JSONObject, filter: JSONObject): boolean {
  const time: number = new Date(String(row["datetime"])).getTime();

  for (const key of Object.keys(filter)) {
    const value: JSONValue | undefined = filter[key];

    switch (key) {
      case "datetime_geq":
        if (!(time >= readFilterTime(value))) {
          return false;
        }
        break;
      case "datetime_lt":
        if (!(time < readFilterTime(value))) {
          return false;
        }
        break;
      case "datetime_gt":
        if (!(time > readFilterTime(value))) {
          return false;
        }
        break;
      case "datetime":
        if (time !== readFilterTime(value)) {
          return false;
        }
        break;
      case "rayName":
        if (String(row["rayName"]) !== String(value)) {
          return false;
        }
        break;
      case "rayName_gt":
        if (!(String(row["rayName"]) > String(value))) {
          return false;
        }
        break;
      case "matchIndex_gt":
        if (!(Number(row["matchIndex"]) > Number(value))) {
          return false;
        }
        break;
      case "OR":
        if (
          !(value as JSONArray).some((alternative: JSONValue): boolean => {
            return passes(row, alternative as JSONObject);
          })
        ) {
          return false;
        }
        break;
      default:
        throw new Error(`The fake does not filter on ${key}`);
    }
  }

  return true;
}

export default class CloudflareFakeApi {
  public requests: Array<FakeRequest> = [];
  public zones: Array<FakeZone> = [];
  public token: { status: string; expiresOn?: string | null } = {
    status: "active",
    expiresOn: null,
  };
  // Answers 401 on /user/tokens/verify, as Cloudflare does for an account's own token.
  public isAccountOwnedToken: boolean = false;
  // The token Cloudflare accepts; any other is refused.
  public acceptedToken: string = TOKEN;
  // Whether the token has Zone > Zone > Read.
  public canListZones: boolean = true;
  // Ignores the OR filter, as a broken page would, to exercise the run's own dedupe.
  public ignoresAfterFilter: boolean = false;
  public scripted: Array<ScriptedAnswer> = [];

  public constructor(zones: Array<FakeZone> = []) {
    this.zones = zones;
  }

  public script(answer: ScriptedAnswer): this {
    this.scripted.push(answer);
    return this;
  }

  // Requests of one kind, in the order they were sent.
  public sent(operation: string): Array<FakeRequest> {
    return this.requests.filter((request: FakeRequest): boolean => {
      return request.operation === operation;
    });
  }

  public transport(): (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse> {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      return this.answer(request);
    };
  }

  private answer(request: DataSourceHttpRequest): DataSourceHttpResponse {
    const url: URL = new URL(request.url);
    const query: Dictionary<string> = {};
    url.searchParams.forEach((value: string, key: string): void => {
      query[key] = value;
    });

    let operation: string = `${request.method} ${url.pathname}`;
    let variables: JSONObject = {};
    let queryText: string = "";

    if (url.pathname.endsWith("/graphql")) {
      const body: JSONObject = JSON.parse(String(request.body)) as JSONObject;
      queryText = String(body["query"]);
      variables = (body["variables"] as JSONObject) || {};
      const match: RegExpMatchArray | null =
        queryText.match(/query\s+([A-Za-z]+)/);
      operation = match ? match[1]! : "graphql";
    }

    const recorded: FakeRequest = {
      method: request.method,
      path: url.pathname,
      query,
      operation,
      variables,
      queryText,
      headers: request.headers || {},
    };
    this.requests.push(recorded);

    const scripted: ScriptedAnswer | undefined = this.scripted.find(
      (answer: ScriptedAnswer): boolean => {
        return answer.times > 0 && answer.matches(recorded);
      },
    );

    if (scripted) {
      scripted.times -= 1;
      return scripted.response;
    }

    if (
      (request.headers || {})["Authorization"] !==
      `Bearer ${this.acceptedToken}`
    ) {
      return url.pathname.endsWith("/graphql")
        ? graphQlError("Unauthorized", 401)
        : restError(401, 1000, "Invalid API Token");
    }

    if (url.pathname.endsWith("/user/tokens/verify")) {
      if (this.isAccountOwnedToken) {
        return restError(401, 1000, "Invalid API Token");
      }

      return this.tokenStatus();
    }

    if (url.pathname.endsWith("/tokens/verify")) {
      return this.tokenStatus();
    }

    if (url.pathname.endsWith("/zones")) {
      return this.listZones(query);
    }

    if (operation === "OneUptimeFirewallEventSettings") {
      return this.settings(variables);
    }

    if (operation === "OneUptimeFirewallEvents") {
      return this.events(variables);
    }

    if (operation === "OneUptimeFirewallEventCounts") {
      return this.counts(variables);
    }

    const more: DataSourceHttpResponse | null = this.answerMore(
      recorded,
      request,
    );

    if (more) {
      return more;
    }

    return restError(404, 7003, "Could not route to the requested resource");
  }

  /*
   * The routes a fake built on this one answers beside the read routes
   * (CloudflareBlockingFakeApi: blocking's lists, rules and IP Access
   * Rules), after the token is checked. Null for a route it does not know.
   */
  protected answerMore(
    _recorded: FakeRequest,
    _request: DataSourceHttpRequest,
  ): DataSourceHttpResponse | null {
    return null;
  }

  private tokenStatus(): DataSourceHttpResponse {
    return json(200, {
      success: true,
      errors: [],
      messages: [
        { code: 10000, message: "This API Token is valid and active" },
      ],
      result: {
        id: "ed17574386854bf78a67040be0a770b0",
        status: this.token.status,
        ...(this.token.expiresOn ? { expires_on: this.token.expiresOn } : {}),
      },
    });
  }

  private listZones(query: Dictionary<string>): DataSourceHttpResponse {
    if (!this.canListZones) {
      return restError(403, 9109, "Unauthorized to access requested resource");
    }

    const accountId: string | undefined = query["account.id"];
    const all: Array<FakeZone> = this.zones.filter(
      (zone: FakeZone): boolean => {
        return !accountId || (zone.accountId || ACCOUNT_ID) === accountId;
      },
    );
    const perPage: number = Number(query["per_page"] || 20);
    const page: number = Number(query["page"] || 1);
    const slice: Array<FakeZone> = all.slice(
      (page - 1) * perPage,
      page * perPage,
    );

    return json(200, {
      success: true,
      errors: [],
      messages: [],
      result: slice.map((zone: FakeZone): JSONObject => {
        return {
          id: zone.id,
          name: zone.name,
          status: zone.status || "active",
          account: {
            id: zone.accountId || ACCOUNT_ID,
            name: zone.accountName || "Acme Corp",
          },
          plan: zone.plan || { name: "Free Website", legacy_id: "free" },
        };
      }),
      result_info: {
        page,
        per_page: perPage,
        count: slice.length,
        total_count: all.length,
        total_pages: Math.max(1, Math.ceil(all.length / perPage)),
      },
    });
  }

  private zoneOf(zoneTag: string): FakeZone | undefined {
    return this.zones.find((zone: FakeZone): boolean => {
      return zone.id === zoneTag;
    });
  }

  /*
   * A query that names a zone the token may not read is refused whole, as
   * Cloudflare refuses it: "zones [...] are not authorized".
   */
  private refusal(zoneTags: Array<string>): DataSourceHttpResponse | null {
    const refused: Array<string> = zoneTags.filter(
      (zoneTag: string): boolean => {
        return this.zoneOf(zoneTag)?.analytics === false;
      },
    );

    return refused.length
      ? graphQlError(`zones ${JSON.stringify(refused)} are not authorized`, 200)
      : null;
  }

  private settings(variables: JSONObject): DataSourceHttpResponse {
    const zoneTags: Array<string> =
      (variables["zoneTags"] as Array<string>) || [];
    const refusal: DataSourceHttpResponse | null = this.refusal(zoneTags);

    if (refusal) {
      return refusal;
    }

    return json(200, {
      data: {
        viewer: {
          zones: zoneTags
            .filter((zoneTag: string): boolean => {
              return Boolean(this.zoneOf(zoneTag));
            })
            .map((zoneTag: string): JSONObject => {
              const zone: FakeZone = this.zoneOf(zoneTag)!;

              return {
                zoneTag,
                settings: {
                  firewallEventsAdaptive:
                    zone.settings === null
                      ? null
                      : {
                          enabled: true,
                          maxDuration: 2592000,
                          maxNumberOfFields: 30,
                          maxPageSize: 10000,
                          notOlderThan: 2678400,
                          ...(zone.settings || {}),
                        },
                },
              };
            }),
        },
      },
      errors: null,
    });
  }

  private events(variables: JSONObject): DataSourceHttpResponse {
    const zoneTag: string = String(variables["zoneTag"]);
    const refusal: DataSourceHttpResponse | null = this.refusal([zoneTag]);

    if (refusal) {
      return refusal;
    }

    const zone: FakeZone | undefined = this.zoneOf(zoneTag);
    const filter: JSONObject = {
      ...((variables["filter"] as JSONObject) || {}),
    };

    if (this.ignoresAfterFilter) {
      delete filter["OR"];
    }

    const limit: number = Number(variables["limit"]);
    const rows: Array<JSONObject> = (zone?.events || [])
      .filter((row: JSONObject): boolean => {
        return passes(row, filter);
      })
      .sort(compareRows)
      .slice(0, limit);

    return json(200, {
      data: {
        viewer: {
          zones: zone ? [{ firewallEventsAdaptive: rows }] : [],
        },
      },
      errors: null,
    });
  }

  private counts(variables: JSONObject): DataSourceHttpResponse {
    const zoneTags: Array<string> =
      (variables["zoneTags"] as Array<string>) || [];
    const filter: JSONObject = (variables["filter"] as JSONObject) || {};

    return json(200, {
      data: {
        viewer: {
          zones: zoneTags.map((zoneTag: string): JSONObject => {
            let count: number = 0;

            for (const row of this.zoneOf(zoneTag)?.events || []) {
              if (passes(row, filter)) {
                count += Number(row["sampleInterval"] || 1);
              }
            }

            return {
              zoneTag,
              firewallEventsAdaptiveGroups: count ? [{ count }] : [],
            };
          }),
        },
      },
      errors: null,
    });
  }
}
