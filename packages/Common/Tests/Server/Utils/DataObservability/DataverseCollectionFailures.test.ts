import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataverseApi, {
  DATAVERSE_RETRY_BUDGET_IN_MS,
  DataverseConnection,
  DataverseRequestError,
  DataverseTablesRead,
  DataverseThrottledError,
} from "../../../../Server/Utils/DataObservability/DataverseApi";
import {
  assembleSnapshot,
  collectTableHealth,
  CollectedTable,
  describeSkippedDataverseTables,
  TableHealthCollectOptions,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { JSONObject } from "../../../../Types/JSON";
import FakeDataverse, {
  FAKE_REQUEST_ID,
  FAKE_SECRET,
  FAKE_TABLES,
  FAKE_TOKEN,
  FAKE_TOKEN_URL,
  FAKE_WEB_API,
  FakeRequest,
  fakeConnection,
  fakeConnectionString,
  fakeEmpty,
  fakeError,
  fakeJson,
  isAcceptedAnnotationPattern,
  isPreferRejectedByDataverse,
} from "./FakeDataverse";

/*
 * ISSUE #9506: A DATAVERSE COLLECTION THAT FAILED WITH AN EMPTY 500.
 *
 * Every Web API request carried Prefer: odata.include-annotations="none",
 * a pattern Dataverse's OData library throws on, so Dataverse answered
 * each with an empty 500 and the table list - the first request, and the
 * one whose failure fails the collection - never came back. What is held
 * here, against a fake that answers as Dataverse does (FakeDataverse):
 *
 *  - every request is one Microsoft documents, with the documented headers
 *    and no Prefer;
 *  - a failed answer says what was being read, Dataverse's own code and
 *    message, how often it was asked and its request ID - never a token or
 *    the app's secret;
 *  - a 429, a 408 or a 5xx is asked again after its Retry-After or a
 *    backoff, within a minute of waiting per collection;
 *  - one table Dataverse cannot read leaves out only itself, and the
 *    collection says which and why;
 *  - a table list Dataverse fails is read in smaller requests, and a list
 *    read so marks no table dropped.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const CORE_COUNT_TABLES: Array<string> = [
  "account",
  "contact",
  "cr123_project",
  "email",
];

// A read of one of the cr123_t tables' newest row: its entity set's path, then its query.
const NEWEST_ROW_OF_A_TABLE: RegExp = /\/cr123_t\d+s\?/;

function client(
  fake: FakeDataverse,
  options: {
    waits?: Array<number>;
    now?: () => number;
    connection?: Partial<DataverseConnection>;
  } = {},
): DataverseApi {
  return new DataverseApi({
    connection: fakeConnection(options.connection),
    transport: fake.transport,
    sleep: async (ms: number): Promise<void> => {
      options.waits?.push(ms);
    },
    ...(options.now ? { now: options.now } : {}),
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("It did not fail.");
}

// The tables a count asked for.
function namesCounted(request: FakeRequest): Array<string> {
  return JSON.parse(request.query.get("@p1") || "[]") as Array<string>;
}

function isCount(request: FakeRequest): boolean {
  return request.path === "/RetrieveTotalRecordCount(EntityNames=@p1)";
}

function isTableList(request: FakeRequest): boolean {
  return (
    request.path === "/EntityDefinitions" &&
    !request.query.has("$filter") &&
    !request.query.has("$expand")
  );
}

function isColumnRead(request: FakeRequest): boolean {
  return request.path === "/EntityDefinitions" && request.query.has("$expand");
}

// A count answer for every table asked about: its position in the list.
function countAll(request: FakeRequest): DataSourceHttpResponse {
  const names: Array<string> = namesCounted(request);

  return fakeJson({
    EntityRecordCountCollection: {
      Count: names.length,
      Keys: names,
      Values: names.map((_: string, index: number): number => {
        return index + 1;
      }),
    },
  });
}

describe("issue #9506: the include-annotations preference Dataverse answered with an empty 500", () => {
  test.each([
    ["*", true],
    ["-*", true],
    ["Microsoft.Dynamics.CRM.*", true],
    ["OData.Community.Display.V1.FormattedValue", true],
    ["Microsoft.PowerApps.CDS.*", true],
    ["-Microsoft.Dynamics.CRM.lookuplogicalname", true],
    // What OneUptime sent: no dot, so no namespace and term.
    ["none", false],
    // What another client met the same empty 500 with: a * inside a segment.
    ["Microsoft.PowerApps.CDS.ErrorDetails*", false],
    ["Microsoft..CRM", false],
    ["Microsoft.*.CRM", false],
    ["", false],
  ])(
    "Dataverse's OData library takes the pattern %j: %j",
    (pattern: string, isAccepted: boolean) => {
      expect(isAcceptedAnnotationPattern(pattern)).toBe(isAccepted);
    },
  );

  test("the fake fails a request carrying what OneUptime sent, as Dataverse did: an empty 500", async () => {
    const fake: FakeDataverse = new FakeDataverse();
    const answer: DataSourceHttpResponse = await fake.transport({
      method: "GET",
      url: `${FAKE_WEB_API}/EntityDefinitions?$select=LogicalName`,
      headers: {
        Accept: "application/json",
        Prefer: 'odata.include-annotations="none"',
      },
    });

    expect(answer.statusCode).toBe(500);
    expect(answer.bodyText).toBe("");
    expect(
      isPreferRejectedByDataverse({ Prefer: 'odata.include-annotations="*"' }),
    ).toBe(false);
    expect(
      isPreferRejectedByDataverse({
        Prefer: "respond-async,odata.include-annotations=none",
      }),
    ).toBe(true);
    expect(isPreferRejectedByDataverse({})).toBe(false);
  });

  test("against such an environment, a whole collection reads every default table", async () => {
    const fake: FakeDataverse = new FakeDataverse();

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
    });

    expect(names(snapshot)).toEqual([
      "account",
      "contact",
      "cr123_project",
      "cr123_reading",
      "email",
    ]);
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.warnings).toEqual([]);
    expect(tableOf(snapshot, "account").estimatedRows).toBe(100);
    expect(tableOf(snapshot, "account").columns).toHaveLength(2);
  });

  test("the answer the issue met says what it is: an empty 500, while listing the tables", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isTableList(request)
          ? fakeEmpty(500, { "x-ms-service-request-id": FAKE_REQUEST_ID })
          : null;
      },
    );
    const error: Error = await rejectionOf(client(fake).listTables());

    expect(error.message).toBe(
      `Dataverse answered 500 while listing the tables (EntityDefinitions), with no error message. Tried 3 times. Request ID: ${FAKE_REQUEST_ID}.`,
    );
  });
});

describe("the requests a collection sends, as Microsoft documents them", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every Web API request carries the documented headers and no Prefer", async () => {
    const fake: FakeDataverse = new FakeDataverse();

    useFake(fake);
    await collect({ queryHistoryLookbackInSeconds: 3600 });

    // And when the table list fails, the smaller requests too.
    fake.answer((request: FakeRequest) => {
      return isTableList(request)
        ? fakeError(500, "0x80040216", "An unexpected error occurred.")
        : null;
    });
    await collect({ queryHistoryLookbackInSeconds: 3600 });

    const webApiRequests: Array<FakeRequest> = fake.requests.filter(
      (request: FakeRequest): boolean => {
        return request.path !== "/";
      },
    );

    expect(webApiRequests.length).toBeGreaterThan(10);

    for (const request of webApiRequests) {
      expect(request.headers).toEqual({
        Authorization: `Bearer ${FAKE_TOKEN}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        "If-None-Match": "null",
      });
    }
  });

  test("the table list: one request, its $select alone - no $top, $skip, $orderby or $expand", async () => {
    const fake: FakeDataverse = new FakeDataverse();

    await client(fake).listTables();

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.path).toBe("/EntityDefinitions");
    expect(Array.from(fake.requests[0]!.query.keys())).toEqual(["$select"]);
    expect(fake.requests[0]!.query.get("$select")).toBe(
      "LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity",
    );
  });

  test("the counts: a function with its names in a parameter alias, a JSON array of fifty at most", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isCount(request) ? countAll(request) : null;
      },
    );
    const tables: Array<string> = Array.from(
      { length: 120 },
      (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      },
    );

    await client(fake).countRows(tables);

    expect(fake.requests).toHaveLength(3);

    for (const request of fake.requests) {
      // The path segment stays the same few characters, whatever the names (Dataverse caps a segment at 260).
      expect(request.url.pathname).toBe(
        "/api/data/v9.2/RetrieveTotalRecordCount(EntityNames=@p1)",
      );
      expect(Array.from(request.query.keys())).toEqual(["@p1"]);
      expect(request.query.get("@p1")).toMatch(
        /^\["cr123_t\d+"(,"cr123_t\d+")*\]$/,
      );
    }

    expect(
      fake.requests.map(namesCounted).map((list: Array<string>) => {
        return list.length;
      }),
    ).toEqual([50, 50, 20]);
  });

  test("a table's newest row: one column, newest first, one row", async () => {
    const fake: FakeDataverse = new FakeDataverse();

    await client(fake).readNewestChange("accounts");

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.path).toBe("/accounts");
    expect(Object.fromEntries(fake.requests[0]!.query.entries())).toEqual({
      $select: "modifiedon",
      $orderby: "modifiedon desc",
      $top: "1",
    });
  });

  test("the columns: twenty named tables a request, never every table's Attributes at once", async () => {
    const fake: FakeDataverse = new FakeDataverse();
    const tables: Array<string> = Array.from(
      { length: 45 },
      (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      },
    );

    await client(fake).listColumns(tables);

    expect(fake.requests).toHaveLength(3);

    for (const request of fake.requests) {
      expect(Array.from(request.query.keys())).toEqual([
        "$select",
        "$filter",
        "$expand",
      ]);
      expect(request.query.get("$select")).toBe("LogicalName");
      expect(request.query.get("$expand")).toBe(
        "Attributes($select=LogicalName,AttributeType,AttributeTypeName,AttributeOf,IsValidForRead,RequiredLevel,ColumnNumber)",
      );
      expect(
        (request.query.get("$filter") || "").split(" or ").length,
      ).toBeLessThanOrEqual(20);
    }
  });

  test("when the list failed: definitions by name, twenty a request, and the custom tables by IsCustomEntity", async () => {
    const fake: FakeDataverse = new FakeDataverse();
    const api: DataverseApi = client(fake);
    const named: Array<string> = Array.from(
      { length: 25 },
      (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      },
    );

    await api.readTableDefinitions(["account", ...named, "account"]);
    await api.listCustomTables();

    expect(fake.texts).toEqual([
      `/EntityDefinitions?$select=LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity&$filter=${[
        "account",
        ...named.slice(0, 19),
      ]
        .map((name: string): string => {
          return `LogicalName eq '${name}'`;
        })
        .join(" or ")}`,
      `/EntityDefinitions?$select=LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity&$filter=${named
        .slice(19)
        .map((name: string): string => {
          return `LogicalName eq '${name}'`;
        })
        .join(" or ")}`,
      "/EntityDefinitions?$select=LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity&$filter=IsCustomEntity eq true",
    ]);
  });

  test("a list Dataverse pages is followed page by page, on its own Web API", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (!isTableList(request)) {
          return null;
        }

        return request.query.has("$skiptoken")
          ? fakeJson({ value: [{ LogicalName: "contact" }] })
          : fakeJson({
              value: [{ LogicalName: "account" }],
              "@odata.nextLink": `${FAKE_WEB_API}/EntityDefinitions?$select=LogicalName&$skiptoken=2`,
            });
      },
    );

    expect(await client(fake).listTables()).toEqual([
      { LogicalName: "account" },
      { LogicalName: "contact" },
    ]);
    expect(fake.requests).toHaveLength(2);
  });
});

describe("what a failed answer says", () => {
  function failingList(answer: DataSourceHttpResponse): FakeDataverse {
    return new FakeDataverse().answer((request: FakeRequest) => {
      return isTableList(request) ? answer : null;
    });
  }

  test("Dataverse's own code and message, its first line only", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList(
          fakeError(
            500,
            "0x80040216",
            "An unexpected error occurred.\r\n   at Microsoft.Crm.Extensibility.OrganizationSdkServiceInternal.Execute",
          ),
        ),
      ).listTables(),
    );

    expect(error).toBeInstanceOf(DataverseRequestError);
    expect(error.message).toBe(
      `Dataverse answered 500 (0x80040216) while listing the tables (EntityDefinitions): An unexpected error occurred. Tried 3 times. Request ID: ${FAKE_REQUEST_ID}.`,
    );
    expect((error as DataverseRequestError).statusCode).toBe(500);
    expect((error as DataverseRequestError).errorCode).toBe("0x80040216");
    expect((error as DataverseRequestError).requestId).toBe(FAKE_REQUEST_ID);
    expect((error as DataverseRequestError).attempts).toBe(3);
    expect((error as DataverseRequestError).reason).toBe(
      "Dataverse answered 500 (0x80040216): An unexpected error occurred.",
    );
  });

  test("a code of zero is no code, and a request ID is read from REQ_ID too", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList(
          fakeJson({ error: { code: "0x0", message: "Bad request" } }, 400, {
            req_id: "REQ 7F3C2A10-1B2C-4D5E-8F90-A1B2C3D4E5F6",
          }),
        ),
      ).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse answered 400 while listing the tables (EntityDefinitions): Bad request. Request ID: 7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6.",
    );
  });

  test("a gateway's HTML page is said by its title", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList({
          statusCode: 502,
          bodyText:
            "<!DOCTYPE html>\r\n<html><head><title>502 Bad Gateway</title></head><body><h1>Bad Gateway</h1></body></html>",
          bodyJson: undefined,
        }),
      ).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse answered 502 while listing the tables (EntityDefinitions): 502 Bad Gateway. Tried 3 times.",
    );
  });

  test("an HTML page without a title is said by its words", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList({
          statusCode: 400,
          bodyText:
            "<html><body><style>p{}</style><p>The request &amp; its URL were refused.</p></body></html>",
          bodyJson: undefined,
        }),
      ).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse answered 400 while listing the tables (EntityDefinitions): The request & its URL were refused.",
    );
  });

  test("an answer with no message says so", async () => {
    const error: Error = await rejectionOf(
      client(failingList(fakeJson({}, 400))).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse answered 400 while listing the tables (EntityDefinitions), with no error message.",
    );
  });

  test("a long message is cut, so the whole sentence around it fits", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList(fakeError(400, "0x80040203", "x".repeat(1_000))),
      ).listTables(),
    );

    expect(error.message.length).toBeLessThanOrEqual(300);
    expect(error.message).toMatch(/Request ID: [0-9a-f-]{36}\.$/);
  });

  test("a token or the app's secret repeated in an answer never reaches the error", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList(
          fakeError(
            400,
            "0x80060888",
            `Refused ${FAKE_SECRET} for Bearer ${FAKE_TOKEN} and ${FAKE_TOKEN}`,
          ),
        ),
      ).listTables(),
    );

    expect(error.message).not.toContain(FAKE_SECRET);
    expect(error.message).not.toContain(FAKE_TOKEN);
    expect(error.message).toContain("Refused **** for Bearer **** and ****.");
  });

  test("a refusal says what to do, with Dataverse's code", async () => {
    const error: Error = await rejectionOf(
      client(
        failingList(
          fakeError(
            403,
            "0x80072560",
            "The user is not a member of the organization.",
          ),
        ),
      ).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse refused the app (403, 0x80072560) while listing the tables (EntityDefinitions): The user is not a member of the organization. Add it to the environment as an application user, with a security role that may read the tables.",
    );
  });
});

describe("asking again", () => {
  function flaky(
    answers: Array<DataSourceHttpResponse>,
    matches: (request: FakeRequest) => boolean = isTableList,
  ): FakeDataverse {
    let asked: number = 0;

    return new FakeDataverse().answer((request: FakeRequest) => {
      if (!matches(request)) {
        return null;
      }

      asked++;

      return asked <= answers.length ? answers[asked - 1]! : null;
    });
  }

  test("a 503, then an answer: asked again after two seconds, and read", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = flaky([fakeEmpty(503)]);
    const definitions: Array<JSONObject> = await client(fake, {
      waits,
    }).listTables();

    expect(definitions).toHaveLength(FAKE_TABLES.length);
    expect(fake.requests).toHaveLength(2);
    expect(waits).toEqual([2_000]);
  });

  test("a 500 every time: asked three times, two then four seconds apart, then said", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = flaky([
      fakeEmpty(500),
      fakeEmpty(500),
      fakeEmpty(500),
    ]);
    const error: Error = await rejectionOf(
      client(fake, { waits }).listTables(),
    );

    expect(fake.requests).toHaveLength(3);
    expect(waits).toEqual([2_000, 4_000]);
    expect(error.message).toContain("Tried 3 times.");
  });

  test.each([408, 502, 504])(
    "a %i is asked again too",
    async (statusCode: number) => {
      const fake: FakeDataverse = flaky([fakeEmpty(statusCode)]);

      await client(fake).listTables();

      expect(fake.requests).toHaveLength(2);
    },
  );

  test.each([400, 401, 403, 404, 501])(
    "a %i is never asked again",
    async (statusCode: number) => {
      const waits: Array<number> = [];
      const fake: FakeDataverse = flaky([fakeEmpty(statusCode)]);

      await rejectionOf(client(fake, { waits }).listTables());

      expect(fake.requests).toHaveLength(1);
      expect(waits).toEqual([]);
    },
  );

  test("the Retry-After of a 503 is waited, not the backoff", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = flaky([fakeEmpty(503, { "retry-after": "5" })]);

    await client(fake, { waits }).listTables();

    expect(waits).toEqual([5_000]);
  });

  test("a 429 the collection can wait out is waited out, and holds back the requests sent before its time", async () => {
    const waits: Array<number> = [];
    // The clock stands still, so the time the 429 named never comes by itself.
    const api: DataverseApi = client(
      flaky([fakeJson({}, 429, { "retry-after": "3" })]),
      {
        waits,
        now: (): number => {
          return 1_000_000;
        },
      },
    );

    expect(await api.listTables()).toHaveLength(FAKE_TABLES.length);
    expect(waits).toEqual([3_000]);

    // The next request waits for that time too, though it met no 429 itself.
    await api.readNewestChange("accounts");

    expect(waits).toEqual([3_000, 3_000]);
  });

  test("a 429 asking for more than thirty seconds is not waited out: the throttle is said at once", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = flaky([
      fakeJson({}, 429, { "retry-after": "120" }),
    ]);
    const error: Error = await rejectionOf(
      client(fake, { waits }).listTables(),
    );

    expect(error).toBeInstanceOf(DataverseThrottledError);
    expect((error as DataverseThrottledError).retryAfterInSeconds).toBe(120);
    expect(fake.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("one collection waits a minute at most in all; after that, nothing is asked again", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return request.path === "/accounts" ? fakeEmpty(500) : null;
      },
    );
    const api: DataverseApi = client(fake, { waits });

    for (let read: number = 0; read < 12; read++) {
      await rejectionOf(api.readNewestChange("accounts"));
    }

    // Ten reads asked three times each (two and four seconds), the last two once.
    expect(fake.requests).toHaveLength(10 * 3 + 2);
    expect(
      waits.reduce((sum: number, wait: number): number => {
        return sum + wait;
      }, 0),
    ).toBe(DATAVERSE_RETRY_BUDGET_IN_MS);
  });

  test("Entra ID that fails for now is asked again, then said in its own words", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = new FakeDataverse();
    const api: DataverseApi = new DataverseApi({
      connection: fakeConnection(),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === FAKE_TOKEN_URL) {
          return fakeJson(
            {
              error: "temporarily_unavailable",
              error_description:
                "AADSTS90033: A transient error has occurred. Please try again.\r\nTrace ID: 1",
            },
            503,
          );
        }

        return fake.transport(request);
      },
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });
    const error: Error = await rejectionOf(api.listTables());

    expect(error.message).toBe(
      "Microsoft Entra ID could not sign the app in (503): AADSTS90033: A transient error has occurred. Please try again. Tried 3 times.",
    );
    expect(waits).toEqual([2_000, 4_000]);
    expect(fake.requests).toEqual([]);
  });

  test("an environment that fails to say its tenant says so, not that it names none", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return request.path === "/" ? fakeEmpty(503) : null;
      },
    );
    const error: Error = await rejectionOf(
      client(fake, { connection: { tenantId: null } }).listTables(),
    );

    expect(error.message).toBe(
      "Dataverse answered 503 while asking which tenant the environment is in, with no error message. Tried 3 times.",
    );
  });
});

describe("one table that fails leaves out only itself", () => {
  const BAD: string = "cr123_bad";

  function fiftyWith(bad: string): Array<string> {
    return [
      bad,
      ...Array.from({ length: 49 }, (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      }),
    ];
  }

  test("the counts: a group Dataverse fails is halved until the table it cannot count is found", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (!isCount(request)) {
          return null;
        }

        return namesCounted(request).includes(BAD)
          ? fakeError(
              400,
              "0x80040217",
              `The entity with a name = '${BAD}' was not found in the MetadataCache.`,
            )
          : countAll(request);
      },
    );
    const read: DataverseTablesRead<Map<string, number>> = await client(
      fake,
    ).countRows(fiftyWith(BAD));

    expect(read.result.size).toBe(49);
    expect(read.result.has(BAD)).toBe(false);
    expect(read.skipped).toEqual([
      {
        logicalNames: [BAD],
        reason: `Dataverse answered 400 (0x80040217): The entity with a name = '${BAD}' was not found in the MetadataCache.`,
      },
    ]);
    expect(read.throttle).toBe(null);
    // The group, then two halves at each of six levels.
    expect(fake.requests).toHaveLength(13);
  });

  test("the counts: when both halves fail too, the fault is the count's, and the group is left out after three requests", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isCount(request)
          ? fakeError(404, "0x8006088a", "Resource not found for the segment.")
          : null;
      },
    );
    const read: DataverseTablesRead<Map<string, number>> = await client(
      fake,
    ).countRows(fiftyWith("cr123_also"));

    expect(read.result.size).toBe(0);
    expect(read.skipped).toHaveLength(1);
    expect(read.skipped[0]!.logicalNames).toHaveLength(50);
    expect(fake.requests).toHaveLength(3);
  });

  test("the counts: a table the app's role may not read is left out alone, with Dataverse's reason", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (!isCount(request)) {
          return null;
        }

        return namesCounted(request).includes("cr123_secret")
          ? fakeError(
              403,
              "0x80040220",
              "Principal user is missing prvReadcr123_secret privilege for entity 'cr123_secret'.",
            )
          : countAll(request);
      },
    );
    const read: DataverseTablesRead<Map<string, number>> = await client(
      fake,
    ).countRows(["account", "cr123_secret", "contact"]);

    expect(Array.from(read.result.keys()).sort()).toEqual([
      "account",
      "contact",
    ]);
    expect(read.skipped).toEqual([
      {
        logicalNames: ["cr123_secret"],
        reason:
          "Dataverse refused the app (403, 0x80040220): Principal user is missing prvReadcr123_secret privilege for entity 'cr123_secret'.",
      },
    ]);
  });

  test("the counts: a 401 would fail every read, so it stops them", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isCount(request)
          ? fakeError(401, "0x8006088a", "The token has expired.")
          : null;
      },
    );
    const error: Error = await rejectionOf(
      client(fake).countRows(CORE_COUNT_TABLES),
    );

    expect(error.message).toMatch(
      /^Dataverse refused the app \(401, 0x8006088a\) while counting rows \(RetrieveTotalRecordCount\): The token has expired\./,
    );
    expect(fake.requests).toHaveLength(1);
  });

  test("the counts: a throttle part way hands back what was read", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (!isCount(request)) {
          return null;
        }

        return namesCounted(request).length === 50
          ? countAll(request)
          : fakeJson({}, 429, { "retry-after": "300" });
      },
    );
    const read: DataverseTablesRead<Map<string, number>> = await client(
      fake,
    ).countRows(
      Array.from({ length: 60 }, (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      }),
    );

    expect(read.result.size).toBe(50);
    expect(read.throttle).toBeInstanceOf(DataverseThrottledError);
    expect(read.skipped).toEqual([]);
  });

  test("the columns: a group Dataverse fails is read one table at a time, and the table it cannot describe is left out alone", async () => {
    const waits: Array<number> = [];
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isColumnRead(request) &&
          (request.query.get("$filter") || "").includes("'email'")
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );
    const read: DataverseTablesRead<Map<string, Array<JSONObject>>> =
      await client(fake, { waits }).listColumns([
        "account",
        "email",
        "contact",
      ]);

    expect(Array.from(read.result.keys()).sort()).toEqual([
      "account",
      "contact",
    ]);
    expect(read.skipped).toEqual([
      {
        logicalNames: ["email"],
        reason:
          "Dataverse answered 500 (0x80040216): An unexpected error occurred.",
      },
    ]);
    // The group three times, then account, email three times, and contact.
    expect(fake.requests).toHaveLength(3 + 1 + 3 + 1);
    expect(waits).toEqual([2_000, 4_000, 2_000, 4_000]);
  });

  test("the columns: after three tables in a row fail on their own, the rest of the group is left out with its answer", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isColumnRead(request)
          ? fakeError(400, "0x80060888", "The query is not valid.")
          : null;
      },
    );
    const tables: Array<string> = Array.from(
      { length: 10 },
      (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      },
    );
    const read: DataverseTablesRead<Map<string, Array<JSONObject>>> =
      await client(fake).listColumns(tables);

    expect(read.result.size).toBe(0);
    expect(
      read.skipped.flatMap((entry: { logicalNames: Array<string> }) => {
        return entry.logicalNames;
      }),
    ).toEqual(tables);
    expect(fake.requests).toHaveLength(1 + 3);
  });

  test("the definitions by name: a table the environment has not is simply not there; one Dataverse fails is left out alone", async () => {
    const fake: FakeDataverse = new FakeDataverse([
      ...FAKE_TABLES,
      { logicalName: "cr123_broken" },
    ]).answer((request: FakeRequest) => {
      return request.path === "/EntityDefinitions" &&
        (request.query.get("$filter") || "").includes("'cr123_broken'")
        ? fakeError(400, "0x80040216", "The entity's definition is broken.")
        : null;
    });
    const read: DataverseTablesRead<Array<JSONObject>> = await client(
      fake,
    ).readTableDefinitions([
      "account",
      "cr123_gone",
      "cr123_broken",
      "contact",
    ]);

    expect(
      read.result.map((definition: JSONObject): unknown => {
        return definition["LogicalName"];
      }),
    ).toEqual(["account", "contact"]);
    expect(read.skipped).toEqual([
      {
        logicalNames: ["cr123_broken"],
        reason:
          "Dataverse answered 400 (0x80040216): The entity's definition is broken.",
      },
    ]);
  });

  test("a next page elsewhere is never followed, nor is the token sent there: the list fails, never comes back short", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isTableList(request)
          ? fakeJson({
              value: [{ LogicalName: "account" }],
              "@odata.nextLink":
                "https://evil.example.com/api/data/v9.2/EntityDefinitions?$skiptoken=2",
            })
          : null;
      },
    );
    const error: Error = await rejectionOf(client(fake).listTables());

    expect(error.message).toBe(
      "Dataverse named a next page OneUptime does not follow while listing the tables (EntityDefinitions): the list was not read whole.",
    );
    expect(
      fake.allRequests.some((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("evil.example.com");
      }),
    ).toBe(false);
  });

  test("a 200 that is no list - a proxy's sign-in page - is an error, never an empty list", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isTableList(request)
          ? {
              statusCode: 200,
              bodyText:
                "<html><head><title>Sign in to your account</title></head></html>",
              bodyJson: undefined,
            }
          : null;
      },
    );
    const error: Error = await rejectionOf(client(fake).listTables());

    expect(error.message).toBe(
      "Dataverse answered 200 while listing the tables (EntityDefinitions), but with no list of results: Sign in to your account.",
    );
  });

  test("a redirect is an error, never an empty list", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isTableList(request)
          ? fakeEmpty(302, { location: "https://login.example.com/" })
          : null;
      },
    );
    const error: Error = await rejectionOf(client(fake).listTables());

    expect(error.message).toBe(
      "Dataverse answered 302 while listing the tables (EntityDefinitions), with no error message.",
    );
  });

  test("the warning for tables left out names a few, and says how many and why", () => {
    expect(describeSkippedDataverseTables("The row counts", [])).toBe(null);
    expect(
      describeSkippedDataverseTables("The row counts", [
        { logicalNames: ["cr123_a"], reason: "Dataverse answered 400." },
      ]),
    ).toBe(
      "The row counts of 1 table could not be read (cr123_a): Dataverse answered 400.",
    );
    expect(
      describeSkippedDataverseTables("The columns", [
        {
          logicalNames: ["t1", "t2", "t3", "t4"],
          reason: "Dataverse answered 500.",
        },
        { logicalNames: ["t5", "t6"], reason: "Dataverse answered 403." },
      ]),
    ).toBe(
      "The columns of 6 tables could not be read (t1, t2, t3, t4, t5, ...): Dataverse answered 500.",
    );
  });
});

/*
 * A whole collection, through the transport every Dataverse collection
 * uses, the waits between tries passing at once and written down.
 */
function useFake(fake: FakeDataverse): Array<number> {
  const waits: Array<number> = [];

  jest.spyOn(DataSourceHttpFetch, "fetch").mockImplementation(fake.transport);
  jest
    .spyOn(DataverseApi, "sleep")
    .mockImplementation(async (ms: number): Promise<void> => {
      waits.push(ms);
    });

  return waits;
}

async function collect(
  options: Partial<TableHealthCollectOptions> = {},
  connection: JSONObject = {},
): Promise<TableHealthSnapshot> {
  return await collectTableHealth(
    {
      engine: "dataverse",
      connectionString: fakeConnectionString(connection),
    },
    { maxTables: 100, maxColumns: 1000, exclusions: [], ...options },
  );
}

function names(snapshot: TableHealthSnapshot): Array<string> {
  return snapshot.tables.map((table: CollectedTable): string => {
    return table.name;
  });
}

function tableOf(snapshot: TableHealthSnapshot, name: string): CollectedTable {
  const found: CollectedTable | undefined = snapshot.tables.find(
    (table: CollectedTable): boolean => {
      return table.name === name;
    },
  );

  if (!found) {
    throw new Error(`No table ${name}`);
  }

  return found;
}

describe("a collection goes on when part of it fails", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const LIST_FAILED: string =
    "Listing every table failed, so tables were read in smaller requests and none is marked dropped: Dataverse answered 500 (0x80040216): An unexpected error occurred.";

  test("a table list Dataverse fails is read in smaller requests: the collection goes on, and marks nothing dropped", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isTableList(request)
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );
    const waits: Array<number> = useFake(fake);
    const snapshot: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
    });

    // The same tables the whole list gives: the core ones it has, and its own custom ones.
    expect(names(snapshot)).toEqual([
      "account",
      "contact",
      "cr123_project",
      "cr123_reading",
      "email",
    ]);
    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.warnings).toEqual([LIST_FAILED]);
    expect(tableOf(snapshot, "account").estimatedRows).toBe(100);
    expect(tableOf(snapshot, "cr123_project").columns).toHaveLength(2);
    expect(waits).toEqual([2_000, 4_000]);
    // Never every table's Attributes in one request.
    expect(
      fake.requests.filter((request: FakeRequest): boolean => {
        return isColumnRead(request) && !request.query.has("$filter");
      }),
    ).toEqual([]);
  });

  test("a table list that fails once costs only the retry: the collection is whole", async () => {
    let failed: boolean = false;
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (!isTableList(request) || failed) {
          return null;
        }

        failed = true;

        return fakeEmpty(503);
      },
    );
    const waits: Array<number> = useFake(fake);
    const snapshot: TableHealthSnapshot = await collect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.warnings).toEqual([]);
    expect(names(snapshot)).toHaveLength(5);
    expect(waits).toEqual([2_000]);
  });

  test("when the smaller requests read no table either, the list's own failure fails the collection, in Dataverse's words", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return request.path === "/EntityDefinitions"
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );

    useFake(fake);

    await expect(collect()).rejects.toThrow(
      `Dataverse answered 500 (0x80040216) while listing the tables (EntityDefinitions): An unexpected error occurred. Tried 3 times. Request ID: ${FAKE_REQUEST_ID}.`,
    );
  });

  test("an app Dataverse refuses fails the collection at once: no smaller request is tried", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return request.path === "/EntityDefinitions"
          ? fakeError(
              403,
              "0x80072560",
              "The user is not a member of the organization.",
            )
          : null;
      },
    );

    useFake(fake);

    await expect(collect()).rejects.toThrow(
      /^Dataverse refused the app \(403, 0x80072560\) while listing the tables/,
    );
    expect(fake.requests).toHaveLength(1);
  });

  test("an environment that cannot be reached fails the collection at once: no smaller request is tried", async () => {
    const fake: FakeDataverse = new FakeDataverse();

    useFake(fake);
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          if (request.url.includes("/EntityDefinitions")) {
            throw new Error(
              "Could not reach data source: connect ECONNREFUSED 10.0.0.1:443",
            );
          }

          return fake.transport(request);
        },
      );

    await expect(collect()).rejects.toThrow(
      "Could not reach data source: connect ECONNREFUSED 10.0.0.1:443",
    );
  });

  test("a table whose newest row Dataverse fails is left out alone, with Dataverse's code", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return request.path === "/accounts"
          ? fakeError(500, "0x80044151", "Generic SQL error.")
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect();

    expect(snapshot.isComplete).toBe(true);
    expect(tableOf(snapshot, "account").secondsSinceChange).toBe(null);
    expect(tableOf(snapshot, "account").estimatedRows).toBe(100);
    expect(tableOf(snapshot, "email").secondsSinceChange).not.toBe(null);
    expect(snapshot.warnings).toEqual([
      "When 1 table last changed could not be read (account): Dataverse answered 500 (0x80044151): Generic SQL error.",
    ]);
  });

  test("a table Dataverse cannot count leaves only its own count out", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isCount(request) &&
          namesCounted(request).includes("cr123_project")
          ? fakeError(
              400,
              "0x80040217",
              "The entity cr123_project is not counted.",
            )
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect();

    expect(tableOf(snapshot, "account").estimatedRows).toBe(100);
    expect(tableOf(snapshot, "contact").estimatedRows).toBe(200);
    expect(tableOf(snapshot, "email").estimatedRows).toBe(400);
    expect(tableOf(snapshot, "cr123_project").estimatedRows).toBe(null);
    expect(snapshot.warnings).toEqual([
      "The row counts of 1 table could not be read (cr123_project): Dataverse answered 400 (0x80040217): The entity cr123_project is not counted.",
    ]);
  });

  test("a table whose columns Dataverse fails is left unread alone, never taken for one with no columns", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        return isColumnRead(request) &&
          (request.query.get("$filter") || "").includes("'email'")
          ? fakeError(500, "0x80040216", "An unexpected error occurred.")
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect({
      queryHistoryLookbackInSeconds: 3600,
    });

    expect(tableOf(snapshot, "email").columns).toBe(null);
    expect(tableOf(snapshot, "email").columnsNotRead).toBe(true);
    expect(tableOf(snapshot, "account").columns).toHaveLength(2);
    expect(tableOf(snapshot, "account").columnsNotRead).toBeUndefined();
    expect(snapshot.warnings).toEqual([
      "The columns of 1 table could not be read (email): Dataverse answered 500 (0x80040216): An unexpected error occurred.",
    ]);
  });

  test("a named table Dataverse could not describe is said to be unread, not missing from the environment", async () => {
    const fake: FakeDataverse = new FakeDataverse([
      ...FAKE_TABLES,
      { logicalName: "cr123_broken", rows: 3, changedSecondsAgo: 5 },
    ]).answer((request: FakeRequest) => {
      if (isTableList(request)) {
        return fakeError(500, "0x80040216", "An unexpected error occurred.");
      }

      return request.path === "/EntityDefinitions" &&
        !request.query.has("$expand") &&
        (request.query.get("$filter") || "").includes("'cr123_broken'")
        ? fakeError(400, "0x80040216", "The entity's definition is broken.")
        : null;
    });

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect(
      {},
      { tables: ["cr123_broken", "cr123_gone"] },
    );

    expect(names(snapshot)).not.toContain("cr123_broken");
    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.warnings).toEqual([
      LIST_FAILED,
      "The definitions of 1 table could not be read (cr123_broken): Dataverse answered 400 (0x80040216): The entity's definition is broken.",
      "The connection names tables this environment does not have, or that cannot be watched: cr123_gone.",
    ]);
  });

  test("when the custom tables cannot be listed either, the core and named tables are still read, and that is said", async () => {
    const fake: FakeDataverse = new FakeDataverse().answer(
      (request: FakeRequest) => {
        if (isTableList(request)) {
          return fakeError(500, "0x80040216", "An unexpected error occurred.");
        }

        return request.query.get("$filter") === "IsCustomEntity eq true"
          ? fakeError(500, "0x80040216", "The custom tables failed.")
          : null;
      },
    );

    useFake(fake);

    const snapshot: TableHealthSnapshot = await collect();

    expect(names(snapshot)).toEqual(["account", "contact", "email"]);
    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.warnings).toEqual([
      LIST_FAILED,
      "The environment's own custom tables could not be listed: Dataverse answered 500 (0x80040216): The custom tables failed.",
    ]);
  });

  test("tables Dataverse cannot be asked about at all stop the reads after three, and the rest are said not asked", async () => {
    const tables: Array<{
      logicalName: string;
      isCustomEntity: boolean;
      rows: number;
      changedSecondsAgo: number;
    }> = Array.from({ length: 10 }, (_: unknown, index: number) => {
      return {
        logicalName: `cr123_t${index}`,
        isCustomEntity: true,
        rows: index,
        changedSecondsAgo: 60,
      };
    });
    const fake: FakeDataverse = new FakeDataverse(tables);
    let asked: number = 0;

    useFake(fake);
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          if (NEWEST_ROW_OF_A_TABLE.test(request.url)) {
            asked++;
            throw new Error(
              "Could not reach data source: timeout of 60000ms exceeded",
            );
          }

          return fake.transport(request);
        },
      );

    const snapshot: TableHealthSnapshot = await collect();

    expect(asked).toBeGreaterThanOrEqual(3);
    expect(asked).toBeLessThan(10);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.warnings[0]).toMatch(
      new RegExp(
        `^When ${asked} tables last changed could not be read \\(.+\\): Could not reach data source: timeout of 60000ms exceeded\\. ${10 - asked} more tables were not asked this time\\.$`,
      ),
    );
    // The counts were read all the same.
    expect(tableOf(snapshot, "cr123_t9").estimatedRows).toBe(9);
  });
});

describe("a table list read in smaller requests marks no table dropped", () => {
  test("a partial list is no complete one, below the table limit too", () => {
    const read: Parameters<typeof assembleSnapshot>[0]["read"] = {
      tables: [
        {
          schema: "dbo",
          name: "account",
          kind: DataAssetKind.Table,
          estimatedRows: 1,
          sizeInBytes: null,
          writeCount: null,
          secondsSinceChange: null,
          readCount: null,
          secondsSinceRead: null,
        },
      ],
      columns: [],
      warnings: [],
      secondsSinceStatsReset: null,
    };
    const options: TableHealthCollectOptions = {
      maxTables: 100,
      maxColumns: 1000,
      exclusions: [],
    };

    expect(
      assembleSnapshot({
        engine: "dataverse",
        read,
        options,
        collectedAt: new Date(),
      }).isComplete,
    ).toBe(true);
    expect(
      assembleSnapshot({
        engine: "dataverse",
        read: { ...read, isTableListPartial: true },
        options,
        collectedAt: new Date(),
      }).isComplete,
    ).toBe(false);
  });
});
