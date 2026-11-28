import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  assertReadOnlySearchRequest,
  buildSearchPath,
  groupIndices,
  IndexGroup,
  matchesGlob,
  ListedDataStream,
  MAX_DOCUMENTS_PER_INDEX,
  readDataStreams,
  readEngine,
  readHitSources,
  readListedIndices,
  readMappingFields,
  readSearchExclusions,
  sampleSearchStore,
  SearchHttpRequest,
  SearchHttpResponse,
  SearchTransportError,
  toIndexPattern,
} from "../../../../Server/Utils/DataSecurity/Content/SearchStoreSampler";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { ModelBudget } from "../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import { ModelScanContext } from "../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  MODEL_TURN_STATE_KEY,
  readModelResumeAt,
} from "../../../../Server/Utils/DataSecurity/Model/ModelTurns";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureReadFrom } from "../../../../Types/DataSecurity/DataStorePosture";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import FakeEntityRecognizer, {
  ISSUE_SENTENCE,
} from "./Model/FakeEntityRecognizer";

/*
 * A SEARCH CLUSTER, SAMPLED WITHOUT A WRITE AND WITHOUT A LEAK (#11140).
 *
 * The cluster is a fake that answers the requests the sampler sends - its
 * listings, mappings and searches, and the unauthenticated requests of the
 * endpoint check - and records every one. The real clusters' answers, and
 * the sampler against running Elasticsearch and OpenSearch, are
 * SearchStoreSamplerClusters'. What is held here:
 *
 *  - indices are grouped and chosen as they should be: daily indices one
 *    pattern at its newest index with documents, a data stream by its
 *    name, the hidden, closed, empty and excluded left out, the limits kept;
 *  - every request is a GET with its own timeout, the credentials sent
 *    only on the scan's own requests - never on the endpoint check's;
 *  - a page too large is asked for again halved, a sort an index cannot
 *    take falls back to index order, failures and budgets stop the scan
 *    with the warning that says why;
 *  - nothing read is returned but masked, and no error carries a secret;
 *  - with the names-and-addresses model on, the indices take turns at its
 *    time, as tables do.
 */

const PASSWORD: string = "Cluster-Pass-77";
const CONNECTION: string = `https://reader:${PASSWORD}@search.internal:9200?verify_certificate=false`;

interface FakeIndex {
  name: string;
  status?: "open" | "close";
  createdAt: number;
  mapping?: Record<string, unknown> | undefined;
  documents: Array<Record<string, unknown>>;
}

interface FakeCluster {
  rootStatus: number;
  rootBody: unknown;
  indices: Array<FakeIndex>;
  dataStreams: Array<ListedDataStream>;
  listingStatus: number;
  // Who-am-I answers without credentials.
  whoAmIStatus: number;
  anonymousSearchTotal: number;
  plaintextServed: boolean;
  // A search for more documents than this is too large to take.
  maxPageSize: number;
  // Targets whose searches fail, or whose sort by @timestamp is refused.
  failingTargets: Set<string>;
  unsortableTargets: Set<string>;
  // Mappings that answer 403.
  hiddenMappings: Set<string>;
  // Moves the clock on after each search.
  onSearch?: (() => void) | undefined;
  requests: Array<SearchHttpRequest>;
}

let cluster: FakeCluster;

function person(index: number): Record<string, unknown> {
  return {
    email: `member${index}.lee@acme-corp.com`,
    ssn: `${536 + (index % 50)}-${40 + (index % 50)}-${4300 + index}`,
    password: `letmein${index}`,
    avatar: "aGVsbG8=",
    "@timestamp": new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
  };
}

function people(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return person(index);
  });
}

const PEOPLE_MAPPING: Record<string, unknown> = {
  properties: {
    email: { type: "keyword" },
    ssn: { type: "keyword" },
    password: { type: "keyword" },
    avatar: { type: "binary" },
    "@timestamp": { type: "date" },
  },
};

function freshCluster(): FakeCluster {
  return {
    rootStatus: 200,
    rootBody: { version: { number: "8.15.3", build_flavor: "default" } },
    indices: [
      {
        name: "customers",
        createdAt: 10,
        mapping: PEOPLE_MAPPING,
        documents: people(30),
      },
      {
        name: "app-logs-2026.11.25",
        createdAt: 20,
        mapping: {
          properties: {
            "@timestamp": { type: "date" },
            message: { type: "text" },
          },
        },
        documents: [
          { message: "old day member1.lee@acme-corp.com", "@timestamp": "x" },
        ],
      },
      {
        name: "app-logs-2026.11.26",
        createdAt: 30,
        mapping: {
          properties: {
            "@timestamp": { type: "date" },
            message: { type: "text" },
          },
        },
        documents: [
          { message: "new day member2.lee@acme-corp.com", "@timestamp": "y" },
        ],
      },
      { name: "empty-things", createdAt: 5, documents: [] },
      {
        name: "archive-2020",
        status: "close",
        createdAt: 1,
        documents: people(3),
      },
      { name: ".kibana_1", createdAt: 2, documents: people(3) },
      {
        name: ".ds-checkout-2026.11.26-000001",
        createdAt: 40,
        mapping: {
          properties: {
            "@timestamp": { type: "date" },
            user: { properties: { email: { type: "keyword" } } },
          },
        },
        documents: [
          { "@timestamp": "z", user: { email: "buyer1.silva@acme-corp.com" } },
          { "@timestamp": "z", user: { email: "buyer2.silva@acme-corp.com" } },
        ],
      },
    ],
    dataStreams: [
      {
        name: "checkout",
        indices: [".ds-checkout-2026.11.26-000001"],
        timestampField: "@timestamp",
      },
    ],
    listingStatus: 200,
    whoAmIStatus: 401,
    anonymousSearchTotal: 0,
    plaintextServed: false,
    maxPageSize: 10_000,
    failingTargets: new Set(),
    unsortableTargets: new Set(),
    hiddenMappings: new Set(),
    requests: [],
  };
}

function json(statusCode: number, body: unknown): SearchHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body) };
}

function documentsOf(target: string): Array<Record<string, unknown>> {
  const stream: ListedDataStream | undefined = cluster.dataStreams.find(
    (candidate: ListedDataStream): boolean => {
      return candidate.name === target;
    },
  );
  const names: Array<string> = stream ? stream.indices : [target];

  return cluster.indices
    .filter((index: FakeIndex): boolean => {
      return names.includes(index.name);
    })
    .flatMap((index: FakeIndex) => {
      return index.documents;
    });
}

async function transport(
  request: SearchHttpRequest,
): Promise<SearchHttpResponse> {
  cluster.requests.push(request);

  const url: URL = new URL(request.url);
  const path: string = decodeURIComponent(url.pathname);

  if (url.protocol === "http:") {
    if (!cluster.plaintextServed) {
      throw new SearchTransportError("dropped", "socket hang up");
    }

    return json(401, {});
  }

  if (path === "/") {
    return json(cluster.rootStatus, cluster.rootBody);
  }

  if (
    path === "/_security/_authenticate" ||
    path === "/_plugins/_security/authinfo"
  ) {
    return json(cluster.whoAmIStatus, {});
  }

  if (path === "/_search") {
    return json(200, {
      hits: { total: { value: cluster.anonymousSearchTotal }, hits: [] },
    });
  }

  if (path === "/_cat/indices") {
    return json(
      cluster.listingStatus,
      cluster.listingStatus === 200
        ? cluster.indices.map((index: FakeIndex) => {
            return {
              index: index.name,
              status: index.status || "open",
              "docs.count": String(index.documents.length),
              "creation.date": String(index.createdAt),
            };
          })
        : { error: { type: "security_exception", reason: `no ${PASSWORD}` } },
    );
  }

  if (path === "/_data_stream") {
    return json(200, {
      data_streams: cluster.dataStreams.map((stream: ListedDataStream) => {
        return {
          name: stream.name,
          indices: stream.indices.map((index: string) => {
            return { index_name: index };
          }),
          timestamp_field: { name: stream.timestampField },
        };
      }),
    });
  }

  if (path.endsWith("/_mapping")) {
    const name: string = path.slice(1, -"/_mapping".length);
    const index: FakeIndex | undefined = cluster.indices.find(
      (candidate: FakeIndex): boolean => {
        return candidate.name === name;
      },
    );

    if (cluster.hiddenMappings.has(name)) {
      return json(403, { error: { type: "security_exception" } });
    }

    return json(200, { [name]: { mappings: index?.mapping || {} } });
  }

  if (path.endsWith("/_search")) {
    const target: string = path.slice(1, -"/_search".length);
    const size: number = Number(url.searchParams.get("size"));
    const from: number = Number(url.searchParams.get("from"));
    const sort: string = url.searchParams.get("sort") || "";

    cluster.onSearch?.();

    if (cluster.failingTargets.has(target)) {
      return json(500, {
        error: {
          type: "search_phase_execution_exception",
          reason: `failed for ${PASSWORD}`,
        },
      });
    }

    if (cluster.unsortableTargets.has(target) && sort !== "_doc") {
      return json(400, {
        error: {
          type: "illegal_argument_exception",
          reason: "No mapping found for [@timestamp]",
        },
      });
    }

    if (size > cluster.maxPageSize) {
      throw new SearchTransportError(
        "tooLarge",
        "maxContentLength size of 20971520 exceeded",
      );
    }

    return json(200, {
      hits: {
        hits: documentsOf(target)
          .slice(from, from + size)
          .map((source: Record<string, unknown>) => {
            return { _source: source };
          }),
      },
    });
  }

  throw new Error(`The fake cluster does not answer ${request.method} ${path}`);
}

function options(
  limits: Partial<ContentScanOptions["limits"]> = {},
  rest: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 0,
      maxBytesPerObject: 0,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 25,
      maxTables: 10,
      deadline: new Date(Date.now() + 60_000),
      ...limits,
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
    ...rest,
  };
}

async function sample(
  data: {
    options?: ContentScanOptions;
    connectionString?: string;
    kind?: DataStoreKind;
    readFrom?: DataStorePostureReadFrom;
  } = {},
): Promise<ContentScanResult> {
  return await sampleSearchStore(
    {
      kind: data.kind || DataStoreKind.Elasticsearch,
      connectionString: data.connectionString || CONNECTION,
    },
    data.options || options(),
    {
      transport,
      readFrom: data.readFrom || DataStorePostureReadFrom.Network,
    },
  );
}

function typesAt(result: ContentScanResult, location: string): Array<string> {
  return (
    result.locations.find((entry: LocationFindings): boolean => {
      return entry.location === location;
    })?.classifications || []
  ).map((classification: FieldClassification): string => {
    return classification.dataTypeId;
  });
}

function searches(): Array<URL> {
  return cluster.requests
    .map((request: SearchHttpRequest): URL => {
      return new URL(request.url);
    })
    .filter((url: URL): boolean => {
      return url.pathname.endsWith("/_search") && url.pathname !== "/_search";
    });
}

afterEach(() => {
  jest.useRealTimers();
});

describe("toIndexPattern", () => {
  test("a daily index is its pattern; a plain name stays", () => {
    expect(toIndexPattern("logstash-2026.11.26")).toBe("logstash-*");
    expect(toIndexPattern("filebeat-7.17.0-2026.11.26-000001")).toBe(
      "filebeat-*",
    );
    expect(toIndexPattern("orders-2024")).toBe("orders-*");
    expect(toIndexPattern("customers")).toBe("customers");
    expect(toIndexPattern("users_v2")).toBe("users_v2");
  });
});

describe("readListedIndices and readDataStreams", () => {
  test("read _cat/indices' strings, and leave out rows without a name", () => {
    expect(
      readListedIndices([
        {
          index: "a",
          status: "open",
          "docs.count": "12",
          "creation.date": "99",
        },
        { index: "b", status: "close", "docs.count": null },
        { status: "open" },
        "junk",
      ]),
    ).toEqual([
      { name: "a", isOpen: true, documents: 12, createdAt: 99 },
      { name: "b", isOpen: false, documents: 0, createdAt: 0 },
    ]);
    expect(readListedIndices({ error: "x" })).toEqual([]);
  });

  test("read a stream's backing indices and timestamp field, @timestamp when it says none", () => {
    expect(
      readDataStreams({
        data_streams: [
          {
            name: "logs-web",
            indices: [{ index_name: ".ds-logs-web-000001" }, {}],
            timestamp_field: { name: "event.time" },
          },
          { name: "metrics", indices: [] },
          { indices: [] },
        ],
      }),
    ).toEqual([
      {
        name: "logs-web",
        indices: [".ds-logs-web-000001"],
        timestampField: "event.time",
      },
      { name: "metrics", indices: [], timestampField: "@timestamp" },
    ]);
    expect(readDataStreams({})).toEqual([]);
  });
});

describe("groupIndices", () => {
  test("a stream by its name, daily indices as one pattern at the newest with documents, nothing hidden or closed", () => {
    const groups: Array<IndexGroup> = groupIndices({
      indices: [
        { name: "logs-2026.11.25", isOpen: true, documents: 5, createdAt: 1 },
        { name: "logs-2026.11.26", isOpen: true, documents: 0, createdAt: 2 },
        { name: "customers", isOpen: true, documents: 9, createdAt: 3 },
        { name: "archive", isOpen: false, documents: 9, createdAt: 3 },
        { name: ".security-7", isOpen: true, documents: 9, createdAt: 3 },
        {
          name: ".ds-web-2026.11.26-000002",
          isOpen: true,
          documents: 4,
          createdAt: 9,
        },
        {
          name: ".ds-web-2026.11.25-000001",
          isOpen: true,
          documents: 3,
          createdAt: 8,
        },
        {
          name: ".ds-.logs-deprecation-000001",
          isOpen: true,
          documents: 3,
          createdAt: 8,
        },
        { name: ".ds-orphan-000001", isOpen: true, documents: 3, createdAt: 8 },
      ],
      dataStreams: [
        {
          name: "web",
          indices: [".ds-web-2026.11.25-000001", ".ds-web-2026.11.26-000002"],
          timestampField: "@timestamp",
        },
        {
          name: ".logs-deprecation",
          indices: [".ds-.logs-deprecation-000001"],
          timestampField: "@timestamp",
        },
      ],
    });

    expect(groups).toEqual([
      {
        name: "customers",
        target: "customers",
        mappingIndex: "customers",
        documents: 9,
        isDataStream: false,
      },
      {
        name: "logs-*",
        target: "logs-2026.11.25",
        mappingIndex: "logs-2026.11.25",
        documents: 5,
        isDataStream: false,
      },
      {
        name: "web",
        target: "web",
        mappingIndex: ".ds-web-2026.11.26-000002",
        documents: 7,
        isDataStream: true,
        timestampField: "@timestamp",
      },
    ]);
  });

  test("a pattern none of whose indices holds documents is read at its newest", () => {
    expect(
      groupIndices({
        indices: [
          { name: "t-2026.01.01", isOpen: true, documents: 0, createdAt: 1 },
          { name: "t-2026.01.02", isOpen: true, documents: 0, createdAt: 2 },
        ],
        dataStreams: [],
      })[0]?.target,
    ).toBe("t-2026.01.02");
  });
});

describe("readSearchExclusions", () => {
  const group: IndexGroup = {
    name: "logs-*",
    target: "logs-2026.11.26",
    mappingIndex: "logs-2026.11.26",
    documents: 3,
    isDataStream: false,
  };

  test("an index, its pattern or a glob leaves the group out, without regard to case", () => {
    for (const exclusion of ["logs-*", "LOGS-2026.11.26", "logs-2026*", "*"]) {
      expect(readSearchExclusions([exclusion]).isGroupExcluded(group)).toBe(
        true,
      );
    }

    expect(readSearchExclusions(["metrics-*"]).isGroupExcluded(group)).toBe(
      false,
    );
    expect(readSearchExclusions([" ", ""]).isGroupExcluded(group)).toBe(false);
  });

  test("index.field and index › field leave one field out, arrays and all", () => {
    expect(
      readSearchExclusions(["logs-*.user.email"]).isFieldExcluded(
        group,
        "user.email",
      ),
    ).toBe(true);
    expect(
      readSearchExclusions(["logs-2026.11.26 › tags"]).isFieldExcluded(
        group,
        "tags[]",
      ),
    ).toBe(true);
    expect(
      readSearchExclusions(["logs-*.user"]).isFieldExcluded(
        group,
        "user.email",
      ),
    ).toBe(false);
  });

  test("a glob's dots and brackets are its own characters, not a pattern's", () => {
    const exclusions: ReturnType<typeof readSearchExclusions> =
      readSearchExclusions(["a.b[1]"]);

    expect(
      exclusions.isGroupExcluded({
        ...group,
        name: "a.b[1]",
        target: "a.b[1]",
      }),
    ).toBe(true);
    expect(
      exclusions.isGroupExcluded({ ...group, name: "axb1", target: "axb1" }),
    ).toBe(false);
  });
});

describe("matchesGlob", () => {
  test("a star is any run of characters, a name is matched whole, case aside", () => {
    expect(matchesGlob("logs-2026.11.26", "logs-*")).toBe(true);
    expect(matchesGlob("logs-2026.11.26", "*")).toBe(true);
    expect(matchesGlob("logs-2026.11.26", "*.26")).toBe(true);
    expect(matchesGlob("logs-2026.11.26", "logs-*-11-*")).toBe(false);
    expect(matchesGlob("logs-2026.11.26", "logs*11*26")).toBe(true);
    expect(matchesGlob("Customers", "customers")).toBe(true);
    expect(matchesGlob("customers-eu", "customers")).toBe(false);
    expect(matchesGlob("ab", "a*b*c")).toBe(false);
    // The two ends may not share their characters.
    expect(matchesGlob("aba", "ab*ba")).toBe(false);
    expect(matchesGlob("abba", "ab*ba")).toBe(true);
  });

  test("dots, brackets and question marks are their own characters", () => {
    expect(matchesGlob("a.b[1]?", "a.b[1]?")).toBe(true);
    expect(matchesGlob("axb1", "a.b[1]")).toBe(false);
    expect(matchesGlob("a.b", "a?b")).toBe(false);
  });

  test("a long name and a glob of many stars are read in one walk", () => {
    const name: string = "a".repeat(5000);

    expect(matchesGlob(name, `${"*a".repeat(200)}*b`)).toBe(false);
    expect(matchesGlob(name, `${"*a".repeat(200)}*`)).toBe(true);
  });
});

describe("readMappingFields", () => {
  test("walks objects into dotted paths, Elasticsearch 7 and 6 alike", () => {
    const properties: Record<string, unknown> = {
      email: { type: "keyword", fields: { raw: { type: "keyword" } } },
      user: { properties: { name: { type: "text" }, age: { type: "long" } } },
      payload: { type: "object", enabled: false },
    };
    const expected: Array<{ path: string; type: string }> = [
      { path: "email", type: "keyword" },
      { path: "user.name", type: "text" },
      { path: "user.age", type: "long" },
      { path: "payload", type: "object" },
    ];

    expect(readMappingFields({ idx: { mappings: { properties } } })).toEqual(
      expected,
    );
    expect(
      readMappingFields({ idx: { mappings: { _doc: { properties } } } }),
    ).toEqual(expected);
    expect(readMappingFields({})).toEqual([]);
    expect(readMappingFields(null)).toEqual([]);
  });
});

describe("buildSearchPath", () => {
  test("asks for a page, newest first by its timestamp, without the fields no scan reads", () => {
    const url: URL = new URL(
      `https://x${buildSearchPath({
        target: "logs 1",
        from: 200,
        size: 100,
        sortField: "@timestamp",
        excludedFields: ["avatar", "attachment.data"],
      })}`,
    );

    expect(url.pathname).toBe("/logs%201/_search");
    expect(url.searchParams.get("size")).toBe("100");
    expect(url.searchParams.get("from")).toBe("200");
    expect(url.searchParams.get("sort")).toBe("@timestamp:desc");
    expect(url.searchParams.get("timeout")).toBe("25s");
    expect(url.searchParams.get("track_total_hits")).toBe("false");
    expect(url.searchParams.get("_source_excludes")).toBe(
      "avatar,attachment.data",
    );
  });

  test("in index order without a timestamp, and drops excludes that would not fit in an address", () => {
    const path: string = buildSearchPath({
      target: "t",
      from: 0,
      size: 10,
      sortField: null,
      excludedFields: Array.from(
        { length: 400 },
        (_: unknown, index: number) => {
          return `field_number_${index}`;
        },
      ),
    });

    expect(new URL(`https://x${path}`).searchParams.get("sort")).toBe("_doc");
    expect(path).not.toContain("_source_excludes");
  });
});

describe("readHitSources and readEngine", () => {
  test("read each hit's _source, an empty one for a hit without", () => {
    expect(
      readHitSources({
        hits: { hits: [{ _source: { a: 1 } }, { _id: "x" }, 3] },
      }),
    ).toEqual([{ a: 1 }, {}]);
    expect(readHitSources({})).toEqual([]);
  });

  test("OpenSearch says so in its version; without an answer, the kind does", () => {
    expect(
      readEngine(
        { version: { distribution: "opensearch" } },
        DataStoreKind.Elasticsearch,
      ),
    ).toBe("opensearch");
    expect(
      readEngine({ version: { number: "8.15.3" } }, DataStoreKind.OpenSearch),
    ).toBe("elasticsearch");
    expect(readEngine(undefined, DataStoreKind.OpenSearch)).toBe("opensearch");
    expect(readEngine(undefined, DataStoreKind.Elasticsearch)).toBe(
      "elasticsearch",
    );
  });
});

describe("assertReadOnlySearchRequest", () => {
  test("refuses anything but a GET", () => {
    expect(() => {
      assertReadOnlySearchRequest({
        method: "POST" as never,
        url: "https://x/_bulk",
        headers: {},
        timeoutInMs: 1000,
      });
    }).toThrow(
      "Data Security sends a search cluster nothing but GET requests.",
    );
  });
});

describe("sampleSearchStore", () => {
  test("classifies each field as index › field, and finds passwords kept as they are", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample();

    expect(typesAt(result, "customers › email")).toEqual(["email-address"]);
    expect(typesAt(result, "customers › ssn")).toEqual(["us-ssn"]);
    expect(
      result.locations.find((entry: LocationFindings): boolean => {
        return entry.location === "customers › email";
      })?.locationKind,
    ).toBe(DataStoreLocationKind.Field);
    expect(result.plaintextPasswordFields).toEqual(["customers › password"]);
    expect(typesAt(result, "app-logs-* › message")).toContain("email-address");
    expect(typesAt(result, "checkout › user.email")).toEqual(["email-address"]);
    expect(result.fingerprints["email-address"]).toHaveLength(128);
    expect(result.isComplete).toBe(true);
  });

  test("reads the groups it should, the ones with documents first, and counts what it read", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample();

    expect(result.readLog).toEqual([
      "app-logs-* (app-logs-2026.11.26)",
      "checkout",
      "customers",
    ]);
    expect(result.objectsRead).toBe(3);
    // 25 of the 30 customers (maxRowsPerTable), a day's log, two orders.
    expect(result.rowsRead).toBe(25 + 1 + 2);
    expect(result.bytesRead).toBeGreaterThan(0);
    // Every sampled customer holds an email: all thirty are counted.
    expect(result.estimatedRecords).toBeGreaterThanOrEqual(30);
    expect(JSON.stringify(result)).not.toContain("old day");
  });

  test("never reads a hidden, closed or empty index, nor a binary field", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample();
    const targets: Array<string> = searches().map((url: URL): string => {
      return url.pathname;
    });

    expect(targets).not.toContain("/.kibana_1/_search");
    expect(targets).not.toContain("/archive-2020/_search");
    expect(targets).not.toContain("/empty-things/_search");
    expect(
      searches()
        .find((url: URL): boolean => {
          return url.pathname === "/customers/_search";
        })
        ?.searchParams.get("_source_excludes"),
    ).toBe("avatar");
    expect(JSON.stringify(result.locations)).not.toContain("avatar");
  });

  test("sends nothing but GETs, its credentials only on its own requests, each with a timeout", async () => {
    cluster = freshCluster();
    cluster.whoAmIStatus = 200;

    await sample();

    const authorization: string = `Basic ${Buffer.from(`reader:${PASSWORD}`).toString("base64")}`;

    for (const request of cluster.requests) {
      expect(request.method).toBe("GET");
      expect(request.timeoutInMs).toBeGreaterThanOrEqual(1000);
      expect(request.timeoutInMs).toBeLessThanOrEqual(30_000);

      const url: URL = new URL(request.url);
      const isEndpointCheck: boolean =
        url.protocol === "http:" ||
        url.pathname === "/_security/_authenticate" ||
        url.pathname === "/_search";

      expect(request.headers["Authorization"]).toBe(
        isEndpointCheck ? undefined : authorization,
      );
      // The certificate is checked as the connection says: not at all, here.
      expect(request.tls).toEqual(
        url.protocol === "http:" ? undefined : { rejectUnauthorized: false },
      );
    }

    expect(
      cluster.requests.some((request: SearchHttpRequest): boolean => {
        return new URL(request.url).protocol === "http:";
      }),
    ).toBe(true);
  });

  test("asks the plaintext address at the TLS port, never http's own 80", async () => {
    cluster = freshCluster();

    await sample({
      connectionString: `https://reader:${PASSWORD}@search.internal`,
    });

    const plaintext: SearchHttpRequest | undefined = cluster.requests.find(
      (request: SearchHttpRequest): boolean => {
        return request.url.startsWith("http:");
      },
    );

    expect(plaintext?.url).toBe("http://search.internal:443/");
  });

  test("returns no value it read but masked", async () => {
    cluster = freshCluster();

    const returned: string = JSON.stringify(await sample());

    expect(returned).not.toContain("member3.lee@acme-corp.com");
    expect(returned).not.toContain("539-43-4303");
    expect(returned).not.toContain("letmein3");
    expect(returned).not.toContain("buyer1.silva");
  });

  test("records how exposed the cluster is: credentials required, TLS required", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample();

    expect(result.posture).toEqual(
      expect.objectContaining({
        readFrom: DataStorePostureReadFrom.Network,
        anonymousRead: false,
        anonymousWrite: false,
        publicRead: false,
        publicWrite: false,
        encryptionInTransitEnforced: true,
      }),
    );
  });

  test("anonymous access that reads what the scan's user read: read without credentials", async () => {
    cluster = freshCluster();
    cluster.whoAmIStatus = 200;
    cluster.anonymousSearchTotal = 30;

    const result: ContentScanResult = await sample();

    expect(result.posture?.anonymousRead).toBe(true);
    expect(result.posture?.anonymousWrite).toBeNull();
  });

  test("anonymous access that reads none of it: not read without credentials, as the scan counted documents", async () => {
    cluster = freshCluster();
    cluster.whoAmIStatus = 200;
    cluster.anonymousSearchTotal = 0;

    expect((await sample()).posture?.anonymousRead).toBe(false);
  });

  test("a deadline already passed sends nothing", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample({
      options: options({ deadline: new Date(Date.now() - 1) }),
    });

    expect(cluster.requests).toEqual([]);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toEqual([
      "The scan reached its time limit before it could connect.",
    ]);
  });

  test("a connection it cannot read is a thrown error that names no secret", async () => {
    cluster = freshCluster();

    await expect(
      sample({
        connectionString: `https://reader:${PASSWORD}@search.internal:9200?pretty=1`,
      }),
    ).rejects.toThrow(
      "Could not read the connection: OneUptime reads only api_key and verify_certificate after the address. Remove pretty.",
    );
    expect(cluster.requests).toEqual([]);
  });

  test("credentials the cluster refuses are a thrown error that names no secret", async () => {
    cluster = freshCluster();
    cluster.rootStatus = 401;
    cluster.rootBody = {
      error: { type: "security_exception", reason: `bad ${PASSWORD}` },
    };

    let message: string = "";

    try {
      await sample();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(
      /^Could not connect to the cluster: the cluster refused the user or API key in the connection string \(HTTP 401/,
    );
    expect(message).not.toContain(PASSWORD);
  });

  test("a user without the cluster privilege GET / needs reads on, as the kind says", async () => {
    cluster = freshCluster();
    cluster.rootStatus = 403;
    cluster.rootBody = { error: "no cluster privilege" };

    const result: ContentScanResult = await sample({
      kind: DataStoreKind.OpenSearch,
    });

    expect(result.objectsRead).toBe(3);
    // Asked as OpenSearch is: its own who-am-I.
    expect(
      cluster.requests.some((request: SearchHttpRequest): boolean => {
        return request.url.endsWith("/_plugins/_security/authinfo");
      }),
    ).toBe(true);
  });

  test("a cluster that cannot be reached is a thrown error", async () => {
    cluster = freshCluster();

    await expect(
      sampleSearchStore(
        { kind: DataStoreKind.Elasticsearch, connectionString: CONNECTION },
        options(),
        {
          transport: async (): Promise<SearchHttpResponse> => {
            throw new SearchTransportError(
              "unreachable",
              "Could not reach data source: Connection Refused.",
            );
          },
          readFrom: DataStorePostureReadFrom.Network,
        },
      ),
    ).rejects.toThrow(
      "Could not connect to the cluster: Could not reach data source: Connection Refused.",
    );
  });

  test("indices it cannot list: says so, keeps how exposed it is, and reads nothing", async () => {
    cluster = freshCluster();
    cluster.listingStatus = 403;

    const result: ContentScanResult = await sample();

    expect(result.objectsRead).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^Could not list the indices: HTTP 403: security_exception: no \*\*\*\*$/,
    );
    expect(result.posture?.anonymousRead).toBe(false);
  });

  test("reads at most maxTables groups, the ones with documents first, and says what it left", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample({
      options: options({ maxTables: 2 }),
    });

    expect(result.objectsRead).toBe(2);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      "2 indices were not sampled: the scan reads at most 2 indices.",
    );
  });

  test("reads at most maxRowsPerTable documents of a group, and never more than an index window", async () => {
    cluster = freshCluster();

    await sample({ options: options({ maxRowsPerTable: 7 }) });

    const customers: Array<URL> = searches().filter((url: URL): boolean => {
      return url.pathname === "/customers/_search";
    });

    expect(customers).toHaveLength(1);
    expect(customers[0]?.searchParams.get("size")).toBe("7");
    expect(MAX_DOCUMENTS_PER_INDEX).toBe(10_000);
  });

  test("newest first by @timestamp where the mapping has one, in index order where it does not", async () => {
    cluster = freshCluster();
    cluster.indices[0]!.mapping = {
      properties: { email: { type: "keyword" } },
    };

    await sample();

    const sortOf: (path: string) => string | null = (
      path: string,
    ): string | null => {
      return (
        searches()
          .find((url: URL): boolean => {
            return url.pathname === path;
          })
          ?.searchParams.get("sort") || null
      );
    };

    expect(sortOf("/customers/_search")).toBe("_doc");
    expect(sortOf("/app-logs-2026.11.26/_search")).toBe("@timestamp:desc");
    expect(sortOf("/checkout/_search")).toBe("@timestamp:desc");
  });

  test("a page too large to take is asked for again halved, until the documents wanted are read", async () => {
    cluster = freshCluster();
    cluster.maxPageSize = 6;

    const result: ContentScanResult = await sample({
      options: options({ maxRowsPerTable: 20 }),
    });
    const customers: Array<URL> = searches().filter((url: URL): boolean => {
      return url.pathname === "/customers/_search";
    });

    // 20, 10 and 5 refused; then pages of 5 from 0, 5, 10 and 15.
    expect(
      customers.map((url: URL): string => {
        return `${url.searchParams.get("from")}+${url.searchParams.get("size")}`;
      }),
    ).toEqual(["0+20", "0+10", "0+5", "5+5", "10+5", "15+5"]);
    expect(typesAt(result, "customers › email")).toEqual(["email-address"]);
    expect(result.rowsRead).toBe(20 + 1 + 2);
  });

  test("a sort the index refuses falls back to index order", async () => {
    cluster = freshCluster();
    cluster.unsortableTargets.add("customers");

    const result: ContentScanResult = await sample();
    const sorts: Array<string | null> = searches()
      .filter((url: URL): boolean => {
        return url.pathname === "/customers/_search";
      })
      .map((url: URL): string | null => {
        return url.searchParams.get("sort");
      });

    expect(sorts).toEqual(["@timestamp:desc", "_doc"]);
    expect(typesAt(result, "customers › ssn")).toEqual(["us-ssn"]);
    expect(result.warnings).toEqual([]);
  });

  test("a mapping it may not read: the index is read in index order", async () => {
    cluster = freshCluster();
    cluster.hiddenMappings.add("customers");

    const result: ContentScanResult = await sample();

    expect(
      searches()
        .find((url: URL): boolean => {
          return url.pathname === "/customers/_search";
        })
        ?.searchParams.get("sort"),
    ).toBe("_doc");
    expect(typesAt(result, "customers › email")).toEqual(["email-address"]);
  });

  test("an index that cannot be read is a warning without a secret, and the scan goes on", async () => {
    cluster = freshCluster();
    cluster.failingTargets.add("customers");

    const result: ContentScanResult = await sample();

    expect(result.warnings).toEqual([
      "Could not sample customers: HTTP 500: search_phase_execution_exception: failed for ****",
    ]);
    expect(result.isComplete).toBe(false);
    expect(result.objectsRead).toBe(2);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  test("stops after five indices in a row cannot be read", async () => {
    cluster = freshCluster();
    cluster.indices = Array.from({ length: 7 }, (_: unknown, index: number) => {
      return {
        name: `broken${index}`,
        createdAt: index,
        mapping: PEOPLE_MAPPING,
        documents: people(2),
      };
    });
    cluster.dataStreams = [];

    for (const index of cluster.indices) {
      cluster.failingTargets.add(index.name);
    }

    const result: ContentScanResult = await sample();

    expect(searches()).toHaveLength(5);
    expect(result.warnings).toContain(
      "The scan stopped after 5 indices in a row could not be read.",
    );
  });

  test("stops once it has read its bytes, and says after how many indices", async () => {
    cluster = freshCluster();

    // The first page alone is larger than the budget.
    const result: ContentScanResult = await sample({
      options: options({ maxBytesTotal: 50 }),
    });

    expect(result.objectsRead).toBe(1);
    expect(result.isComplete).toBe(false);
    // Of the four it would read: the empty index counts, as an empty table does.
    expect(result.warnings).toContain(
      "The scan read its 50 bytes after 1 of 4 indices.",
    );
  });

  test("stops at its time limit, and says after how many indices", async () => {
    cluster = freshCluster();
    jest.useFakeTimers({ now: new Date("2026-11-27T10:00:00.000Z") });

    const deadline: Date = new Date("2026-11-27T10:00:30.000Z");

    // Each search takes a minute: the first runs past the deadline.
    cluster.onSearch = (): void => {
      jest.setSystemTime(new Date(Date.now() + 60_000));
    };

    const result: ContentScanResult = await sample({
      options: options({ deadline }),
    });

    expect(result.objectsRead).toBe(1);
    expect(result.warnings).toContain(
      "The scan reached its time limit after 1 of 4 indices.",
    );
    expect(result.isComplete).toBe(false);
  });

  test("skips the store's exclusions: a pattern, a stream and a field", async () => {
    cluster = freshCluster();

    const result: ContentScanResult = await sample({
      options: options(
        {},
        { exclusions: ["app-logs-*", "CHECKOUT", "customers.ssn"] },
      ),
    });

    expect(result.readLog).toEqual(["customers"]);
    expect(typesAt(result, "customers › ssn")).toEqual([]);
    expect(typesAt(result, "customers › email")).toEqual(["email-address"]);
  });

  test("with the model on, the indices take turns at its time, from where the last scan stopped", async () => {
    cluster = freshCluster();
    cluster.indices = ["notes_a", "notes_b", "notes_c"].map(
      (name: string, index: number) => {
        return {
          name,
          createdAt: index,
          mapping: { properties: { note: { type: "text" } } },
          documents: [{ note: ISSUE_SENTENCE }],
        };
      },
    );
    cluster.dataStreams = [];

    const model: ModelScanContext = {
      recognizer: new FakeEntityRecognizer({ millisecondsPerText: 10 }),
      budget: new ModelBudget({ scanLimitInMs: 1000, storeLimitInMs: 1000 }),
    };
    const result: ContentScanResult = await sample({
      options: options(
        {},
        {
          model,
          previousState: { [MODEL_TURN_STATE_KEY]: { resumeAt: "notes_b" } },
        },
      ),
    });

    expect(result.readLog).toEqual(["notes_b", "notes_c", "notes_a"]);
    expect(typesAt(result, "notes_a › note")).toContain("person-name");
    // The model had time for all: the next scan starts at the first.
    expect(readModelResumeAt(result.nextState)).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Maria Gonzalez");
  });

  test("names, never values, of the fields no detector placed, under their index", async () => {
    cluster = freshCluster();
    cluster.indices = [
      {
        name: "orders",
        createdAt: 1,
        mapping: { properties: { voucher: { type: "keyword" } } },
        documents: Array.from({ length: 12 }, (_: unknown, index: number) => {
          return { voucher: `VX-${7000 + index}-QQ` };
        }),
      },
    ];
    cluster.dataStreams = [];

    const result: ContentScanResult = await sample();

    expect(
      (result.unplacedFields || []).map((field: { location: string }) => {
        return field.location;
      }),
    ).toContain("orders › voucher");
    expect(JSON.stringify(result.unplacedFields)).not.toContain("VX-7003-QQ");
  });
});
