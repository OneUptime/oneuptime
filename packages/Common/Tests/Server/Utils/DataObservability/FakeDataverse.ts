import { DataverseConnection } from "../../../../Server/Utils/DataObservability/DataverseApi";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A Microsoft Dataverse environment held in memory, answering OneUptime's
 * Web API requests the way the service does, for the tests of
 * DataverseApi and of a Dataverse collection (Dataverse*.test.ts). Every
 * request is written down. What the service does that this fake does too:
 *
 *  - a Prefer header with an odata.include-annotations pattern that
 *    Dataverse's OData library rejects fails the request with an empty
 *    500, as every request of issue #9506 did (isPreferRejectedByDataverse);
 *  - EntityDefinitions answers a $select, a $filter on the tables' logical
 *    names (LogicalName eq '...' or ...) or on IsCustomEntity, and an
 *    $expand of their Attributes, in one unpaged answer;
 *  - RetrieveTotalRecordCount(EntityNames=@p1) reads @p1 as a JSON array;
 *  - an entity set answers its newest row by $orderby and $top, and a
 *    table that keeps no modifiedon answers 400 when asked for it.
 *
 * A test puts its own answers in front of the environment's (answer()):
 * the first that answers a request is used.
 */

export const FAKE_HOST: string = "contoso.crm.dynamics.com";
export const FAKE_TENANT: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
export const FAKE_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
export const FAKE_SECRET: string = "s3cr3t~Value.With_Special";
// A token shaped as Entra ID's are: a JSON web token.
export const FAKE_TOKEN: string =
  "eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2NvbnRvc28ifQ.c2lnbmF0dXJlLW9mLXRoZS10b2tlbg";
export const FAKE_WEB_API: string = `https://${FAKE_HOST}/api/data/v9.2`;
export const FAKE_TOKEN_URL: string = `https://login.microsoftonline.com/${FAKE_TENANT}/oauth2/v2.0/token`;
export const FAKE_REQUEST_ID: string = "0b6e8ad1-9d2c-4c1e-8f3a-5d7e2b1c4a90";

export function fakeJson(
  body: unknown,
  statusCode: number = 200,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers,
  };
}

// Dataverse's error answer: its own code and message, and the request's ID.
export function fakeError(
  statusCode: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return fakeJson({ error: { code, message } }, statusCode, {
    "x-ms-service-request-id": FAKE_REQUEST_ID,
    ...headers,
  });
}

// An answer with no body at all, as Dataverse gives when its OData library throws.
export function fakeEmpty(
  statusCode: number,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return { statusCode, bodyText: "", bodyJson: undefined, headers };
}

export function fakeConnection(
  overrides: Partial<DataverseConnection> = {},
): DataverseConnection {
  return {
    host: FAKE_HOST,
    tenantId: FAKE_TENANT,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_SECRET,
    tables: [],
    sqlPort: null,
    ...overrides,
  };
}

export function fakeConnectionString(overrides: JSONObject = {}): string {
  return JSON.stringify({
    environmentUrl: `https://${FAKE_HOST}`,
    tenantId: FAKE_TENANT,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_SECRET,
    ...overrides,
  });
}

/*
 * Whether ODataLib (Microsoft.OData.Core's AnnotationFilterPattern, which
 * Dataverse's Web API runs on) accepts a pattern of odata.include-
 * annotations: "*", or a namespace and a term - segments split by dots,
 * none empty - whose "*" can only be a last segment of its own; each may
 * start with "-" to leave annotations out. "none" has no dot, and
 * "Microsoft.PowerApps.CDS.ErrorDetails*" a "*" inside a segment: the
 * library throws on both.
 */
export function isAcceptedAnnotationPattern(pattern: string): boolean {
  const name: string = pattern.startsWith("-") ? pattern.slice(1) : pattern;

  if (name === "*") {
    return true;
  }

  const segments: Array<string> = name.split(".");

  if (segments.length === 1) {
    return false;
  }

  return segments.every((segment: string, index: number): boolean => {
    if (!segment) {
      return false;
    }

    return segment === "*"
      ? index === segments.length - 1
      : !segment.includes("*");
  });
}

const INCLUDE_ANNOTATIONS: RegExp =
  /odata\.include-annotations\s*=\s*(?:"([^"]*)"|([^,;\s]*))/i;

// Whether Dataverse fails a request for its Prefer header: an include-annotations pattern its OData library rejects.
export function isPreferRejectedByDataverse(
  headers: Record<string, string> | undefined,
): boolean {
  const prefer: string = Object.entries(headers || {})
    .filter(([name]: [string, string]): boolean => {
      return name.toLowerCase() === "prefer";
    })
    .map(([, value]: [string, string]): string => {
      return value;
    })
    .join(",");
  const match: RegExpExecArray | null = INCLUDE_ANNOTATIONS.exec(prefer);

  if (!match) {
    return false;
  }

  const value: string = match[1] ?? match[2] ?? "";

  // An empty preference leaves every annotation out; an empty pattern in a list is refused.
  return (
    value.length > 0 &&
    value.split(",").some((pattern: string): boolean => {
      return !isAcceptedAnnotationPattern(pattern.trim());
    })
  );
}

export interface FakeTable {
  logicalName: string;
  // logicalName + "s" when left out.
  entitySetName?: string | undefined;
  tableType?: string | undefined;
  isCustomEntity?: boolean | undefined;
  isIntersect?: boolean | undefined;
  // The daily snapshot's count; left out of it when null.
  rows?: number | null | undefined;
  // How long ago its newest row changed; null for an empty table.
  changedSecondsAgo?: number | null | undefined;
  // False for a table that keeps createdon only.
  hasModifiedOn?: boolean | undefined;
}

// The tables an environment holds unless a test says otherwise.
export const FAKE_TABLES: ReadonlyArray<FakeTable> = [
  { logicalName: "account", rows: 100, changedSecondsAgo: 120 },
  { logicalName: "contact", rows: 200, changedSecondsAgo: null },
  { logicalName: "systemuser", rows: 5, changedSecondsAgo: 30 },
  {
    logicalName: "email",
    tableType: "Activity",
    rows: 400,
    changedSecondsAgo: 600,
  },
  {
    logicalName: "cr123_project",
    isCustomEntity: true,
    rows: 300,
    changedSecondsAgo: 3600,
  },
  {
    logicalName: "cr123_reading",
    isCustomEntity: true,
    tableType: "Elastic",
    rows: null,
    changedSecondsAgo: 60,
  },
  { logicalName: "msdyn_workorder", isCustomEntity: true, rows: 7 },
  {
    logicalName: "cr123_projectmember",
    isCustomEntity: true,
    isIntersect: true,
    rows: 9,
  },
];

// One request as the fake read it: its path under the Web API, its query decoded, and its headers.
export interface FakeRequest {
  method: string;
  url: URL;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  // Path and query, decoded, as a test reads them.
  text: string;
}

export type FakeOverride = (
  request: FakeRequest,
) => DataSourceHttpResponse | null | undefined;

const LOGICAL_NAME_CONDITION: RegExp = /LogicalName eq '([a-z0-9_]+)'/g;

export default class FakeDataverse {
  public readonly tables: Array<FakeTable>;
  // Every Web API request, in the order it came.
  public readonly requests: Array<FakeRequest> = [];
  // Every request at all, to Entra ID too.
  public readonly allRequests: Array<DataSourceHttpRequest> = [];
  private readonly overrides: Array<FakeOverride> = [];

  public constructor(tables: ReadonlyArray<FakeTable> = FAKE_TABLES) {
    this.tables = tables.map((table: FakeTable): FakeTable => {
      return { ...table };
    });
  }

  // Puts an answer in front of the environment's own; it answers the requests it returns a response for.
  public answer(override: FakeOverride): this {
    this.overrides.push(override);

    return this;
  }

  // The Web API requests, as "path?query" with the query decoded.
  public get texts(): Array<string> {
    return this.requests.map((request: FakeRequest): string => {
      return request.text;
    });
  }

  public readonly transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse> = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    this.allRequests.push(request);

    if (request.url === FAKE_TOKEN_URL) {
      return fakeJson({ access_token: FAKE_TOKEN, expires_in: 3600 });
    }

    const url: URL = new URL(request.url);
    const path: string = decodeURIComponent(url.pathname).replace(
      "/api/data/v9.2",
      "",
    );
    const read: FakeRequest = {
      method: request.method,
      url,
      path,
      query: url.searchParams,
      headers: request.headers || {},
      text: `${path}${url.search ? "?" : ""}${decodeURIComponent(url.search.slice(1))}`,
    };

    this.requests.push(read);

    if (isPreferRejectedByDataverse(read.headers)) {
      return fakeEmpty(500, { "x-ms-service-request-id": FAKE_REQUEST_ID });
    }

    for (const override of this.overrides) {
      const answer: DataSourceHttpResponse | null | undefined = override(read);

      if (answer) {
        return answer;
      }
    }

    // Asked without a token, the Web API names the tenant in its challenge.
    if (path === "/") {
      return fakeJson({}, 401, {
        "www-authenticate": `Bearer authorization_uri=https://login.microsoftonline.com/${FAKE_TENANT}/oauth2/authorize, resource_id=https://${FAKE_HOST}/`,
      });
    }

    return this.answerOwn(read);
  };

  public tableOf(logicalName: string): FakeTable | undefined {
    return this.tables.find((table: FakeTable): boolean => {
      return table.logicalName === logicalName;
    });
  }

  private setOf(table: FakeTable): string {
    return table.entitySetName || `${table.logicalName}s`;
  }

  private definitionOf(table: FakeTable): JSONObject {
    return {
      LogicalName: table.logicalName,
      EntitySetName: this.setOf(table),
      TableType: table.tableType || "Standard",
      IsCustomEntity: table.isCustomEntity === true,
      IsIntersect: table.isIntersect === true,
      IsPrivate: false,
      IsLogicalEntity: false,
      IsActivityParty: false,
      IsBPFEntity: false,
    };
  }

  private columnsOf(table: FakeTable): Array<JSONObject> {
    return [
      {
        LogicalName: `${table.logicalName}id`,
        AttributeTypeName: { Value: "UniqueidentifierType" },
        RequiredLevel: { Value: "SystemRequired" },
        ColumnNumber: 1,
      },
      {
        LogicalName: "modifiedon",
        AttributeTypeName: { Value: "DateTimeType" },
        RequiredLevel: { Value: "None" },
        ColumnNumber: 2,
      },
    ];
  }

  // The names a $filter on logical names asks for, or null for a filter of another kind.
  private namesIn(filter: string): Array<string> | null {
    const names: Array<string> = Array.from(
      filter.matchAll(LOGICAL_NAME_CONDITION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    return names.length > 0 ? names : null;
  }

  private answerOwn(request: FakeRequest): DataSourceHttpResponse {
    if (request.path === "/EntityDefinitions") {
      const filter: string = request.query.get("$filter") || "";
      const names: Array<string> | null = this.namesIn(filter);
      const tables: Array<FakeTable> = this.tables.filter(
        (table: FakeTable): boolean => {
          if (names) {
            return names.includes(table.logicalName);
          }

          return filter === "IsCustomEntity eq true"
            ? table.isCustomEntity === true
            : true;
        },
      );

      if (request.query.has("$expand")) {
        return fakeJson({
          value: tables.map((table: FakeTable): JSONObject => {
            return {
              LogicalName: table.logicalName,
              Attributes: this.columnsOf(table),
            };
          }),
        });
      }

      return fakeJson({
        value: tables.map((table: FakeTable): JSONObject => {
          return this.definitionOf(table);
        }),
      });
    }

    if (request.path === "/RetrieveTotalRecordCount(EntityNames=@p1)") {
      const names: Array<string> = JSON.parse(
        request.query.get("@p1") || "[]",
      ) as Array<string>;
      const counted: Array<FakeTable> = names
        .map((name: string): FakeTable | undefined => {
          return this.tableOf(name);
        })
        .filter((table: FakeTable | undefined): table is FakeTable => {
          return table !== undefined && typeof table.rows === "number";
        });

      return fakeJson({
        EntityRecordCountCollection: {
          Count: counted.length,
          IsReadOnly: false,
          Keys: counted.map((table: FakeTable): string => {
            return table.logicalName;
          }),
          Values: counted.map((table: FakeTable): number => {
            return table.rows as number;
          }),
        },
      });
    }

    const table: FakeTable | undefined = this.tables.find(
      (candidate: FakeTable): boolean => {
        return `/${this.setOf(candidate)}` === request.path;
      },
    );

    if (!table) {
      return fakeError(
        404,
        "0x80060888",
        `Resource not found for the segment '${request.path.slice(1)}'.`,
      );
    }

    const column: string = request.query.get("$select") || "";

    if (column === "modifiedon" && table.hasModifiedOn === false) {
      return fakeError(
        400,
        "0x0",
        `Could not find a property named 'modifiedon' on type 'Microsoft.Dynamics.CRM.${table.logicalName}'.`,
      );
    }

    const age: number | null | undefined = table.changedSecondsAgo;

    return fakeJson({
      value:
        age === null || age === undefined
          ? []
          : [{ [column]: new Date(Date.now() - age * 1000).toISOString() }],
    });
  }
}
