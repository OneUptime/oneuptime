import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../../../Types/JSON";

/*
 * A fake Microsoft tenant behind the connector's transport: the Entra
 * token endpoint, Microsoft Graph's sign-in and directory audit lists, and
 * the Office 365 Management Activity API, each answering the way
 * Microsoft's reference pages describe - Graph newest first, filtered by
 * ge and le, paged by @odata.nextLink; the Management API listing content
 * by contentCreated (start inclusive, end exclusive), paged by a
 * NextPageUri header, its blobs fetched by contentUri. Every request is
 * recorded. Not a test file itself.
 */

export const FAKE_TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
export const FAKE_CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
export const FAKE_CLIENT_SECRET: string =
  "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
export const FAKE_ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2dyYXBoIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

export interface FakeFailure {
  statusCode: number;
  body: JSONValue | string;
}

export interface FakeContent {
  contentId: string;
  contentType: string;
  // ISO time Microsoft made the blob available.
  contentCreated: string;
  records: Array<JSONObject>;
}

export interface FakeEntraTenant {
  signIns?: Array<JSONObject> | undefined;
  directoryAudits?: Array<JSONObject> | undefined;
  // The most records a Graph page holds, whatever $top asks for.
  graphPageCap?: number | undefined;
  tokenFailure?: FakeFailure | undefined;
  signInsFailure?: FakeFailure | undefined;
  directoryAuditsFailure?: FakeFailure | undefined;
  subscriptions?: Array<{ contentType: string; status: string }> | undefined;
  subscriptionsFailure?: FakeFailure | undefined;
  startFailures?: Dictionary<FakeFailure> | undefined;
  contents?: Array<FakeContent> | undefined;
  contentPageSize?: number | undefined;
  contentListFailure?: FakeFailure | undefined;
  blobFailure?: FakeFailure | undefined;
}

export interface FakeEntraApi {
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
  requests: Array<DataSourceHttpRequest>;
  tenant: FakeEntraTenant;
}

const GRAPH_HOSTS: Array<string> = [
  "graph.microsoft.com",
  "graph.microsoft.us",
];
const MANAGE_HOSTS: Array<string> = [
  "manage.office.com",
  "manage.office365.us",
];
const LOGIN_HOSTS: Array<string> = [
  "login.microsoftonline.com",
  "login.microsoftonline.us",
];

// "createdDateTime ge 2026-...Z and createdDateTime le 2026-...Z"
const FILTER_BOUND_REGEX: RegExp = /\s(ge|le)\s(\S+)/g;

export function respond(
  statusCode: number,
  body: JSONValue | string,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  const bodyText: string =
    typeof body === "string" ? body : JSON.stringify(body);
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode, bodyText, bodyJson, headers };
}

function fail(failure: FakeFailure): DataSourceHttpResponse {
  return respond(failure.statusCode, failure.body);
}

// The error body Graph and the Management API answer with.
export function apiError(code: string, message: string): JSONObject {
  return { error: { code, message } };
}

function readBounds(filter: string): { start: number; end: number } {
  const bounds: { start: number; end: number } = {
    start: -Infinity,
    end: Infinity,
  };

  for (const match of filter.matchAll(FILTER_BOUND_REGEX)) {
    const time: number = new Date(match[2]!).getTime();

    if (match[1] === "ge") {
      bounds.start = time;
    } else {
      bounds.end = time;
    }
  }

  return bounds;
}

function graphList(
  url: URL,
  records: Array<JSONObject>,
  timeField: string,
  cap: number,
): DataSourceHttpResponse {
  const bounds: { start: number; end: number } = readBounds(
    url.searchParams.get("$filter") || "",
  );
  const top: number = Math.min(
    cap,
    Number(url.searchParams.get("$top") || "1000"),
  );
  const offset: number = Number(url.searchParams.get("$skiptoken") || "0");
  const inWindow: Array<JSONObject> = records
    .filter((record: JSONObject): boolean => {
      const time: number = new Date(String(record[timeField])).getTime();

      return time >= bounds.start && time <= bounds.end;
    })
    .sort((a: JSONObject, b: JSONObject): number => {
      return (
        new Date(String(b[timeField])).getTime() -
        new Date(String(a[timeField])).getTime()
      );
    });
  const page: Array<JSONObject> = inWindow.slice(offset, offset + top);
  const body: JSONObject = {
    "@odata.context": `https://${url.host}/v1.0/$metadata#auditLogs`,
    value: page,
  };

  if (offset + top < inWindow.length) {
    const next: URL = new URL(url.toString());
    next.searchParams.set("$skiptoken", String(offset + top));
    body["@odata.nextLink"] = next.toString();
  }

  return respond(200, body);
}

export function createFakeEntraApi(tenant: FakeEntraTenant): FakeEntraApi {
  const requests: Array<DataSourceHttpRequest> = [];
  const subscriptions: Array<{ contentType: string; status: string }> = (
    tenant.subscriptions || []
  ).map((subscription: { contentType: string; status: string }) => {
    return { ...subscription };
  });

  const transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse> = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);

    if (LOGIN_HOSTS.includes(url.host)) {
      if (tenant.tokenFailure) {
        return fail(tenant.tokenFailure);
      }

      return respond(200, {
        token_type: "Bearer",
        expires_in: 3599,
        access_token: FAKE_ACCESS_TOKEN,
      });
    }

    if (GRAPH_HOSTS.includes(url.host)) {
      const cap: number = tenant.graphPageCap || 1000;

      if (url.pathname.endsWith("/auditLogs/signIns")) {
        if (tenant.signInsFailure) {
          return fail(tenant.signInsFailure);
        }

        return graphList(url, tenant.signIns || [], "createdDateTime", cap);
      }

      if (url.pathname.endsWith("/auditLogs/directoryAudits")) {
        if (tenant.directoryAuditsFailure) {
          return fail(tenant.directoryAuditsFailure);
        }

        return graphList(
          url,
          tenant.directoryAudits || [],
          "activityDateTime",
          cap,
        );
      }

      return respond(404, apiError("Request_ResourceNotFound", "Not found"));
    }

    if (MANAGE_HOSTS.includes(url.host)) {
      const feed: string = `/api/v1.0/${FAKE_TENANT_ID}/activity/feed/`;

      if (!url.pathname.startsWith(feed)) {
        return respond(
          400,
          apiError(
            "AF20010",
            "The tenant ID passed in the URL does not match.",
          ),
        );
      }

      const path: string = url.pathname.slice(feed.length);

      if (path === "subscriptions/list") {
        if (tenant.subscriptionsFailure) {
          return fail(tenant.subscriptionsFailure);
        }

        return respond(
          200,
          subscriptions.map(
            (subscription: { contentType: string; status: string }) => {
              return { ...subscription, webhook: null };
            },
          ),
        );
      }

      if (path === "subscriptions/start" && request.method === "POST") {
        const contentType: string = url.searchParams.get("contentType") || "";
        const failure: FakeFailure | undefined =
          tenant.startFailures?.[contentType];

        if (failure) {
          return fail(failure);
        }

        const existing: { contentType: string; status: string } | undefined =
          subscriptions.find(
            (subscription: { contentType: string; status: string }) => {
              return subscription.contentType === contentType;
            },
          );

        if (existing) {
          existing.status = "enabled";
        } else {
          subscriptions.push({ contentType, status: "enabled" });
        }

        return respond(200, { contentType, status: "enabled", webhook: null });
      }

      if (path === "subscriptions/content") {
        if (tenant.contentListFailure) {
          return fail(tenant.contentListFailure);
        }

        const contentType: string = url.searchParams.get("contentType") || "";
        const subscribed: boolean = subscriptions.some(
          (subscription: { contentType: string; status: string }) => {
            return (
              subscription.contentType === contentType &&
              subscription.status === "enabled"
            );
          },
        );

        if (!subscribed) {
          return respond(
            400,
            apiError(
              "AF20022",
              "No subscription found for the specified content type",
            ),
          );
        }

        // The Management API's times carry no zone and are UTC.
        const start: number = new Date(
          `${url.searchParams.get("startTime")}Z`,
        ).getTime();
        const end: number = new Date(
          `${url.searchParams.get("endTime")}Z`,
        ).getTime();
        const pageSize: number = tenant.contentPageSize || 1000;
        const offset: number = Number(url.searchParams.get("nextPage") || "0");
        const matching: Array<FakeContent> = (tenant.contents || []).filter(
          (content: FakeContent): boolean => {
            const created: number = new Date(content.contentCreated).getTime();

            return (
              content.contentType === contentType &&
              created >= start &&
              created < end
            );
          },
        );
        const page: Array<FakeContent> = matching.slice(
          offset,
          offset + pageSize,
        );
        const headers: Dictionary<string> = {};

        if (offset + pageSize < matching.length) {
          const next: URL = new URL(url.toString());
          next.searchParams.set("nextPage", String(offset + pageSize));
          headers["nextpageuri"] = next.toString();
        }

        return respond(
          200,
          page.map((content: FakeContent): JSONObject => {
            return {
              contentType: content.contentType,
              contentId: content.contentId,
              contentUri: `https://${url.host}/api/v1.0/${FAKE_TENANT_ID}/activity/feed/audit/${content.contentId}`,
              contentCreated: content.contentCreated,
              contentExpiration: "2026-11-06T09:00:00.000Z",
            };
          }),
          headers,
        );
      }

      if (path.startsWith("audit/")) {
        if (tenant.blobFailure) {
          return fail(tenant.blobFailure);
        }

        const contentId: string = path.slice("audit/".length);
        const content: FakeContent | undefined = (tenant.contents || []).find(
          (candidate: FakeContent): boolean => {
            return candidate.contentId === contentId;
          },
        );

        return content
          ? respond(200, content.records)
          : respond(
              404,
              apiError("AF20050", "The specified content does not exist."),
            );
      }
    }

    return respond(404, "not found");
  };

  return { transport, requests, tenant };
}

// The requests that went to a host, by path.
export function requestsTo(
  api: FakeEntraApi,
  pathEnd: string,
): Array<DataSourceHttpRequest> {
  return api.requests.filter((request: DataSourceHttpRequest): boolean => {
    return new URL(request.url).pathname.endsWith(pathEnd);
  });
}
