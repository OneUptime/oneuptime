/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import https from "https";
import {
  sampleSearchStore,
  SearchHttpRequest,
  SearchHttpResponse,
  SearchHttpTransport,
} from "../../../../Server/Utils/DataSecurity/Content/SearchStoreSampler";
import { createProbeSearchTransport } from "../../../../Server/Utils/DataSecurity/Content/SearchStoreHttp";
import {
  ContentScanOptions,
  ContentScanResult,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  DataSecurityCheckStatus,
  EvaluatedCheck,
  evaluateDataStoreChecks,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
  DataStorePostureReadFrom,
  getDataStoreExposure,
} from "../../../../Types/DataSecurity/DataStorePosture";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";

/*
 * ELASTICSEARCH AND OPENSEARCH, SAMPLED FOR REAL (#11140).
 *
 * Against running clusters, every one this file is given: each is seeded
 * with indices of its own (named dsx-...) - customers with emails, SSNs,
 * card numbers and passwords kept as they are; a day's logs in two daily
 * indices; a data stream; an empty, a closed and a hidden index - and
 * sampled through the transport a probe sends with (createProbeSearchTransport:
 * the egress guard, the pinned address, the TLS settings), with a read-only
 * user where the cluster has security. What is held, on each:
 *
 *  - what is found, and where: "index › field", daily indices as one
 *    pattern, a data stream by its name; nothing of a hidden, closed or
 *    empty index, nor of a field no scan reads (binary);
 *  - nothing the scan read is in what it returns but masked;
 *  - nothing is written: every request is a GET, and every seeded index
 *    holds the documents it held, no index more;
 *  - the cluster's exposure, as asked without credentials: refused on a
 *    secure one, read - and written - on an open one, read on one with
 *    anonymous access, plaintext refused over TLS and taken without it.
 *
 * Opt in with RUN_SEARCH_STORE_CLUSTER_TESTS=true and the clusters'
 * addresses; a cluster whose address is not given is skipped. Each URL is
 * the cluster's own address (a private address: loopback is refused by the
 * egress guard, as for any probe), and _ADMIN its superuser as user:password,
 * for seeding:
 *
 *   SEARCH_STORE_TEST_ELASTICSEARCH_URL, _ADMIN     Elasticsearch 8, security on, TLS
 *   SEARCH_STORE_TEST_ELASTICSEARCH_CA              its http_ca.crt, PEM (optional)
 *   SEARCH_STORE_TEST_ELASTICSEARCH_OPEN_URL        Elasticsearch 8, security off
 *   SEARCH_STORE_TEST_ELASTICSEARCH_ANONYMOUS_URL, _ADMIN
 *                                                   Elasticsearch 8, anonymous users hold "viewer"
 *   SEARCH_STORE_TEST_ELASTICSEARCH7_OPEN_URL       Elasticsearch 7.17, security off
 *   SEARCH_STORE_TEST_OPENSEARCH_URL, _ADMIN        OpenSearch 2, security plugin on, TLS
 *   SEARCH_STORE_TEST_OPENSEARCH_OPEN_URL           OpenSearch 2, security plugin off
 *
 * Every index, template, user and API key it makes is removed afterwards.
 */
const RUN: boolean = process.env["RUN_SEARCH_STORE_CLUSTER_TESTS"] === "true";

const describeClusters: typeof describe.skip = RUN ? describe : describe.skip;

const READER: string = "dsx_reader";
const READER_PASSWORD: string = "Reader-Pass-11140-dsx!";
const SEEDED_INDICES: Array<string> = [
  "dsx-customers",
  "dsx-app-logs-2026.11.25",
  "dsx-app-logs-2026.11.26",
  "dsx-empty-things",
  "dsx-closed-2020",
  ".dsx-internal",
];
const STREAM: string = "dsx-checkout-stream";
const TEMPLATE: string = "dsx-checkout-template";
const CUSTOMERS: number = 24;

interface Cluster {
  name: string;
  kind: DataStoreKind;
  url: string;
  // user:password of a superuser, for seeding; none for a cluster without security.
  admin: string | null;
  security: "on" | "off" | "anonymous";
  engine: "elasticsearch" | "opensearch";
  ca?: string | undefined;
}

function readClusters(): Array<Cluster> {
  const clusters: Array<Cluster> = [];
  const env: NodeJS.ProcessEnv = process.env;

  // A cluster is tested only when its address is set in the environment.
  type MaybeCluster = Omit<Cluster, "url"> & { url?: string | undefined };

  const add: (cluster: MaybeCluster) => void = (
    cluster: MaybeCluster,
  ): void => {
    if (cluster.url) {
      clusters.push({ ...cluster, url: cluster.url });
    }
  };

  add({
    name: "Elasticsearch 8, security on",
    kind: DataStoreKind.Elasticsearch,
    url: env["SEARCH_STORE_TEST_ELASTICSEARCH_URL"],
    admin: env["SEARCH_STORE_TEST_ELASTICSEARCH_ADMIN"] || null,
    security: "on",
    engine: "elasticsearch",
    ca: env["SEARCH_STORE_TEST_ELASTICSEARCH_CA"],
  });
  add({
    name: "Elasticsearch 8, security off",
    kind: DataStoreKind.Elasticsearch,
    url: env["SEARCH_STORE_TEST_ELASTICSEARCH_OPEN_URL"],
    admin: null,
    security: "off",
    engine: "elasticsearch",
  });
  add({
    name: "Elasticsearch 8, anonymous access",
    kind: DataStoreKind.Elasticsearch,
    url: env["SEARCH_STORE_TEST_ELASTICSEARCH_ANONYMOUS_URL"],
    admin: env["SEARCH_STORE_TEST_ELASTICSEARCH_ANONYMOUS_ADMIN"] || null,
    security: "anonymous",
    engine: "elasticsearch",
  });
  add({
    name: "Elasticsearch 7.17, security off",
    kind: DataStoreKind.Elasticsearch,
    url: env["SEARCH_STORE_TEST_ELASTICSEARCH7_OPEN_URL"],
    admin: null,
    security: "off",
    engine: "elasticsearch",
  });
  add({
    name: "OpenSearch 2, security plugin on",
    kind: DataStoreKind.OpenSearch,
    url: env["SEARCH_STORE_TEST_OPENSEARCH_URL"],
    admin: env["SEARCH_STORE_TEST_OPENSEARCH_ADMIN"] || null,
    security: "on",
    engine: "opensearch",
  });
  add({
    name: "OpenSearch 2, security plugin off",
    kind: DataStoreKind.OpenSearch,
    url: env["SEARCH_STORE_TEST_OPENSEARCH_OPEN_URL"],
    admin: null,
    security: "off",
    engine: "opensearch",
  });

  return clusters;
}

const CLUSTERS: Array<Cluster> = RUN ? readClusters() : [];

interface Answer {
  status: number;
  json: unknown;
  text: string;
}

// One request to a cluster, for seeding and for checking: never the sampler's.
function call(
  cluster: Cluster,
  method: string,
  path: string,
  body?: unknown,
  auth?: string | null,
): Promise<Answer> {
  const url: URL = new URL(`${cluster.url}${path}`);
  const payload: string | undefined =
    body === undefined
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const credentials: string | null = auth === undefined ? cluster.admin : auth;
  const client: typeof http | typeof https =
    url.protocol === "https:" ? https : http;

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = client.request(
        url,
        {
          method,
          rejectUnauthorized: false,
          headers: {
            "Content-Type": path.endsWith("/_bulk")
              ? "application/x-ndjson"
              : "application/json",
            ...(credentials
              ? {
                  Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
                }
              : {}),
          },
          timeout: 60_000,
        } as https.RequestOptions,
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let json: unknown = undefined;

            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }

            resolve({ status: response.statusCode || 0, json, text });
          });
        },
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy(new Error(`${method} ${path} timed out`));
      });

      if (payload !== undefined) {
        request.write(payload);
      }

      request.end();
    },
  );
}

async function must(
  cluster: Cluster,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const answer: Answer = await call(cluster, method, path, body);

  if (answer.status < 200 || answer.status >= 300) {
    throw new Error(
      `${cluster.name}: ${method} ${path} answered ${answer.status}: ${answer.text.slice(0, 500)}`,
    );
  }

  return answer;
}

// A card number that passes the Luhn check, from fifteen digits of its own.
function luhn(body: string): string {
  let sum: number = 0;

  for (let index: number = 0; index < body.length; index++) {
    let digit: number = Number(body[body.length - 1 - index]);

    if (index % 2 === 0) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return `${body}${(10 - (sum % 10)) % 10}`;
}

function customer(index: number): Record<string, unknown> {
  return {
    name: `Member ${index} Lee`,
    email: `member${index}.lee@acme-corp.com`,
    ssn: `${536 + index}-${40 + index}-${4300 + index}`,
    card: luhn(`453201511283${String(100 + index).padStart(3, "0")}`),
    password: `letmein${index}x`,
    is_admin: index % 2 === 0,
    avatar: Buffer.from("x".repeat(64)).toString("base64"),
    signed_up: `2026-10-${String(1 + (index % 28)).padStart(2, "0")}T08:00:00Z`,
    address: { city: "Lisbon", street: `Rua Augusta ${index}` },
    tags: ["vip", `cohort-${index % 3}`],
  };
}

const RAW_VALUES: Array<string> = [
  "member3.lee@acme-corp.com",
  "539-43-4303",
  luhn("453201511283103"),
  "letmein3x",
];

async function removeSeeded(cluster: Cluster): Promise<void> {
  for (const index of SEEDED_INDICES) {
    await call(cluster, "DELETE", `/${encodeURIComponent(index)}`);
  }

  await call(cluster, "DELETE", `/_data_stream/${STREAM}`);
  await call(cluster, "DELETE", `/_index_template/${TEMPLATE}`);
}

async function seed(cluster: Cluster): Promise<void> {
  await removeSeeded(cluster);

  await must(cluster, "PUT", "/dsx-customers", {
    settings: { number_of_shards: 2, number_of_replicas: 0 },
    mappings: {
      properties: {
        name: { type: "text" },
        email: { type: "keyword" },
        ssn: { type: "keyword" },
        card: { type: "keyword" },
        password: { type: "keyword" },
        is_admin: { type: "boolean" },
        avatar: { type: "binary" },
        signed_up: { type: "date" },
        address: {
          properties: {
            city: { type: "keyword" },
            street: { type: "text" },
          },
        },
        tags: { type: "keyword" },
      },
    },
  });

  const bulk: Array<string> = [];

  for (let index: number = 0; index < CUSTOMERS; index++) {
    bulk.push(JSON.stringify({ index: { _index: "dsx-customers" } }));
    bulk.push(JSON.stringify(customer(index)));
  }

  await must(cluster, "POST", "/_bulk?refresh=true", `${bulk.join("\n")}\n`);

  for (const day of ["2026.11.25", "2026.11.26"]) {
    await must(cluster, "PUT", `/dsx-app-logs-${day}`, {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          "@timestamp": { type: "date" },
          message: { type: "text" },
          level: { type: "keyword" },
        },
      },
    });

    const lines: Array<string> = [];

    for (let index: number = 0; index < 12; index++) {
      lines.push(JSON.stringify({ index: { _index: `dsx-app-logs-${day}` } }));
      lines.push(
        JSON.stringify({
          "@timestamp": `${day.split(".").join("-")}T10:${String(index).padStart(2, "0")}:00Z`,
          level: "info",
          message: `Password reset sent to member${index}.lee@acme-corp.com for account ${index}`,
        }),
      );
    }

    await must(cluster, "POST", "/_bulk?refresh=true", `${lines.join("\n")}\n`);
  }

  await must(cluster, "PUT", `/_index_template/${TEMPLATE}`, {
    index_patterns: [`${STREAM}*`],
    data_stream: {},
    priority: 500,
    template: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          "@timestamp": { type: "date" },
          user: { properties: { email: { type: "keyword" } } },
          order: { type: "keyword" },
        },
      },
    },
  });

  const events: Array<string> = [];

  for (let index: number = 0; index < 10; index++) {
    events.push(JSON.stringify({ create: { _index: STREAM } }));
    events.push(
      JSON.stringify({
        "@timestamp": `2026-11-26T12:${String(index).padStart(2, "0")}:00Z`,
        user: { email: `buyer${index}.silva@acme-corp.com` },
        order: `ORD-${1000 + index}`,
      }),
    );
  }

  await must(cluster, "POST", "/_bulk?refresh=true", `${events.join("\n")}\n`);

  await must(cluster, "PUT", "/dsx-empty-things", {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
  });

  await must(cluster, "PUT", "/dsx-closed-2020", {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
  });
  await must(cluster, "POST", "/dsx-closed-2020/_doc?refresh=true", {
    email: "closed.person@acme-corp.com",
  });
  await must(cluster, "POST", "/dsx-closed-2020/_close");

  await must(cluster, "PUT", "/.dsx-internal", {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
  });
  await must(cluster, "POST", "/.dsx-internal/_doc?refresh=true", {
    email: "hidden.person@acme-corp.com",
    ssn: "550-55-5501",
  });

  if (cluster.security !== "off" && cluster.engine === "elasticsearch") {
    await must(cluster, "PUT", `/_security/role/${READER}`, {
      cluster: ["monitor"],
      indices: [
        {
          names: ["*"],
          privileges: ["read", "view_index_metadata", "monitor"],
        },
      ],
    });
    await must(cluster, "PUT", `/_security/user/${READER}`, {
      password: READER_PASSWORD,
      roles: [READER],
    });
  }

  if (cluster.security === "on" && cluster.engine === "opensearch") {
    await must(cluster, "PUT", `/_plugins/_security/api/roles/${READER}`, {
      cluster_permissions: ["cluster_monitor"],
      index_permissions: [
        {
          index_patterns: ["*"],
          allowed_actions: [
            "read",
            "indices_monitor",
            "indices:admin/mappings/get",
            "indices:admin/data_stream/get",
          ],
        },
      ],
    });
    await must(
      cluster,
      "PUT",
      `/_plugins/_security/api/internalusers/${READER}`,
      { password: READER_PASSWORD, backend_roles: [] },
    );
    await must(
      cluster,
      "PUT",
      `/_plugins/_security/api/rolesmapping/${READER}`,
      { users: [READER] },
    );
  }
}

async function removeReader(cluster: Cluster): Promise<void> {
  if (cluster.security !== "off" && cluster.engine === "elasticsearch") {
    await call(cluster, "DELETE", `/_security/user/${READER}`);
    await call(cluster, "DELETE", `/_security/role/${READER}`);
    await call(cluster, "DELETE", "/_security/api_key", {
      name: "dsx-reader-key",
    });
  }

  if (cluster.security === "on" && cluster.engine === "opensearch") {
    await call(
      cluster,
      "DELETE",
      `/_plugins/_security/api/rolesmapping/${READER}`,
    );
    await call(
      cluster,
      "DELETE",
      `/_plugins/_security/api/internalusers/${READER}`,
    );
    await call(cluster, "DELETE", `/_plugins/_security/api/roles/${READER}`);
  }
}

// The seeded indices' documents, and every index there is, to prove nothing was written.
async function snapshot(cluster: Cluster): Promise<Record<string, string>> {
  const answer: Answer = await must(
    cluster,
    "GET",
    "/_cat/indices?format=json&h=index,docs.count&expand_wildcards=all",
  );
  const counts: Record<string, string> = {};

  for (const row of answer.json as Array<Record<string, string>>) {
    // OneUptime's own requests leave nothing; a cluster's own system indices change on their own.
    if (row["index"]?.startsWith(".") && !row["index"].startsWith(".dsx")) {
      continue;
    }

    if (row["index"]?.startsWith(".ds-") && !row["index"].includes("dsx")) {
      continue;
    }

    /*
     * OpenSearch's security plugin keeps an audit log of the requests it is
     * sent - the scan's among them, its refused unauthenticated ones too: the
     * cluster's own record of being read, written by the cluster.
     */
    if (row["index"]?.startsWith("security-auditlog-")) {
      continue;
    }

    counts[row["index"] || ""] = row["docs.count"] || "";
  }

  return counts;
}

function connectionOf(
  cluster: Cluster,
  options: { password?: string; query?: string } = {},
): string {
  const url: URL = new URL(cluster.url);

  // A cluster with security of its own is scanned with its read-only user.
  if (cluster.security !== "off") {
    url.username = READER;
    url.password = options.password ?? READER_PASSWORD;
  }

  const query: string =
    options.query !== undefined
      ? options.query
      : url.protocol === "https:"
        ? "verify_certificate=false"
        : "";

  return `${url.toString().replace(/\/$/, "")}${query ? `?${query}` : ""}`;
}

function scanOptions(
  overrides: Partial<ContentScanOptions["limits"]> = {},
  rest: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 0,
      maxBytesPerObject: 0,
      maxBytesTotal: 32 * 1024 * 1024,
      maxRowsPerTable: 50,
      maxTables: 50,
      deadline: new Date(Date.now() + 120_000),
      ...overrides,
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "search-cluster-test-key",
    ...rest,
  };
}

interface RecordedTransport {
  transport: SearchHttpTransport;
  requests: Array<SearchHttpRequest>;
}

// The probe's own transport, every request it sends written down.
function recorded(): RecordedTransport {
  const requests: Array<SearchHttpRequest> = [];
  const inner: SearchHttpTransport = createProbeSearchTransport();

  return {
    requests,
    transport: async (
      request: SearchHttpRequest,
    ): Promise<SearchHttpResponse> => {
      requests.push(request);
      return await inner(request);
    },
  };
}

function typesAt(result: ContentScanResult, location: string): Array<string> {
  const found: LocationFindings | undefined = result.locations.find(
    (entry: LocationFindings): boolean => {
      return entry.location === location;
    },
  );

  return (found?.classifications || []).map(
    (classification: FieldClassification): string => {
      return classification.dataTypeId;
    },
  );
}

function checkOf(
  posture: DataStorePostureFacts,
  kind: DataStoreKind,
  id: string,
): EvaluatedCheck | undefined {
  return evaluateDataStoreChecks({
    kind,
    name: "cluster",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: ["us-ssn"],
    dataCategories: [],
    posture,
    isPublicByDesign: false,
    hasOwner: true,
  }).find((check: EvaluatedCheck): boolean => {
    return check.check.id === id;
  });
}

describeClusters("SearchStoreSampler against real clusters", () => {
  test("is given at least one cluster to sample", () => {
    expect(CLUSTERS.length).toBeGreaterThan(0);
  });

  for (const cluster of CLUSTERS) {
    describe(cluster.name, () => {
      let result: ContentScanResult;
      let requests: Array<SearchHttpRequest>;
      let before: Record<string, string>;
      let after: Record<string, string>;

      beforeAll(async () => {
        await seed(cluster);
        before = await snapshot(cluster);

        const transport: RecordedTransport = recorded();

        result = await sampleSearchStore(
          { kind: cluster.kind, connectionString: connectionOf(cluster) },
          scanOptions(),
          {
            transport: transport.transport,
            readFrom: DataStorePostureReadFrom.Network,
          },
        );
        requests = transport.requests;
        after = await snapshot(cluster);
      }, 240_000);

      afterAll(async () => {
        await removeSeeded(cluster);
        await removeReader(cluster);
      }, 120_000);

      test("finds each customer field's data type, by index and field", () => {
        expect(typesAt(result, "dsx-customers › email")).toContain(
          "email-address",
        );
        expect(typesAt(result, "dsx-customers › ssn")).toContain("us-ssn");
        expect(typesAt(result, "dsx-customers › card")).toContain(
          "credit-card-number",
        );
        expect(result.plaintextPasswordFields).toContain(
          "dsx-customers › password",
        );
      });

      test("reads daily indices as one pattern, at its newest index, and a data stream by its name", () => {
        expect(typesAt(result, "dsx-app-logs-* › message")).toContain(
          "email-address",
        );
        expect(typesAt(result, `${STREAM} › user.email`)).toContain(
          "email-address",
        );
        expect(result.readLog).toEqual(
          expect.arrayContaining([
            "dsx-customers",
            "dsx-app-logs-* (dsx-app-logs-2026.11.26)",
            STREAM,
          ]),
        );
        expect(
          result.readLog.filter((entry: string): boolean => {
            return entry.startsWith("dsx-app-logs");
          }),
        ).toHaveLength(1);
      });

      test("reads nothing of a hidden, closed or empty index, nor a binary field", () => {
        const names: string = JSON.stringify({
          locations: result.locations.map((entry: LocationFindings) => {
            return entry.location;
          }),
          readLog: result.readLog,
        });

        expect(names).not.toContain(".dsx-internal");
        expect(names).not.toContain("dsx-closed-2020");
        expect(names).not.toContain("dsx-empty-things");
        expect(names).not.toContain("avatar");
        expect(JSON.stringify(result)).not.toContain("hidden.person");
        expect(JSON.stringify(result)).not.toContain("closed.person");
      });

      test("keeps no value it read but masked", () => {
        const returned: string = JSON.stringify(result);

        for (const value of RAW_VALUES) {
          expect(returned).not.toContain(value);
        }
      });

      test("writes nothing: every request is a GET, and every index holds what it held", () => {
        expect(requests.length).toBeGreaterThan(0);

        for (const request of requests) {
          expect(request.method).toBe("GET");
        }

        expect(after).toEqual(before);
      });

      test("counts what it read and estimates the records holding sensitive data", () => {
        expect(result.objectsRead).toBeGreaterThanOrEqual(3);
        expect(result.rowsRead).toBeGreaterThanOrEqual(CUSTOMERS + 12 + 10);
        expect(result.bytesRead).toBeGreaterThan(0);
        expect(result.estimatedRecords).toBeGreaterThanOrEqual(CUSTOMERS);
        expect(result.fingerprints["email-address"]?.length).toBeGreaterThan(0);
      });

      test("says how exposed the cluster is, as it answered without credentials", () => {
        const posture: DataStorePostureFacts = result.posture!;
        const isHttps: boolean = cluster.url.startsWith("https:");

        expect(posture.readFrom).toBe(DataStorePostureReadFrom.Network);
        expect(posture.publicNetworkAccess).toBeNull();
        expect(posture.openToAllAddresses).toBeNull();
        expect(posture.unknowableFacts).toEqual(
          expect.arrayContaining(["publicNetworkAccess", "openToAllAddresses"]),
        );
        expect(posture.encryptionInTransitEnforced).toBe(isHttps);

        if (isHttps) {
          expect(posture.minimumTlsVersion).toBeNull();
          expect(posture.unknowableFacts).toContain("minimumTlsVersion");
        } else {
          expect(posture.minimumTlsVersion).toBeUndefined();
        }

        if (cluster.security === "on") {
          expect(posture.anonymousRead).toBe(false);
          expect(posture.anonymousWrite).toBe(false);
          expect(posture.publicRead).toBe(false);
          expect(posture.publicWrite).toBe(false);
          expect(
            checkOf(posture, cluster.kind, "readable-without-credentials")
              ?.result.status,
          ).toBe(DataSecurityCheckStatus.Pass);
        }

        if (cluster.security === "off") {
          expect(posture.anonymousRead).toBe(true);
          expect(posture.anonymousWrite).toBe(true);
          expect(posture.publicRead).toBeNull();
          expect(posture.unknowableFacts).toContain("publicRead");

          const check: EvaluatedCheck | undefined = checkOf(
            posture,
            cluster.kind,
            "readable-without-credentials",
          );

          expect(check?.result.status).toBe(DataSecurityCheckStatus.Fail);
          expect(check?.severity).toBe("Critical");
        }

        if (cluster.security === "anonymous") {
          expect(posture.anonymousRead).toBe(true);
          expect(posture.anonymousWrite).toBeNull();
          expect(posture.unknowableFacts).toContain("anonymousWrite");
          expect(
            checkOf(posture, cluster.kind, "readable-without-credentials")
              ?.result.status,
          ).toBe(DataSecurityCheckStatus.Fail);
        }

        // From inside the network, whether the internet reaches it cannot be told.
        expect(getDataStoreExposure(posture, cluster.kind)).toBe(
          DataStoreExposure.Unknown,
        );
      });

      test("reached from outside every network (OneUptime Cloud), the cluster is internet reachable", async () => {
        const outside: ContentScanResult = await sampleSearchStore(
          { kind: cluster.kind, connectionString: connectionOf(cluster) },
          scanOptions({ maxTables: 1, maxRowsPerTable: 1 }),
          {
            transport: createProbeSearchTransport(),
            readFrom: DataStorePostureReadFrom.Internet,
          },
        );

        expect(outside.posture?.publicNetworkAccess).toBe(true);
        expect(outside.posture?.unknowableFacts).not.toContain(
          "publicNetworkAccess",
        );
        expect(getDataStoreExposure(outside.posture, cluster.kind)).toBe(
          DataStoreExposure.InternetReachable,
        );
      }, 120_000);

      test("skips what the store's exclusions name: a pattern, and one field", async () => {
        const excluded: ContentScanResult = await sampleSearchStore(
          { kind: cluster.kind, connectionString: connectionOf(cluster) },
          scanOptions(
            {},
            { exclusions: ["dsx-app-logs-*", "dsx-customers.ssn"] },
          ),
          {
            transport: createProbeSearchTransport(),
            readFrom: DataStorePostureReadFrom.Network,
          },
        );

        expect(typesAt(excluded, "dsx-customers › ssn")).toEqual([]);
        expect(typesAt(excluded, "dsx-customers › email")).toContain(
          "email-address",
        );
        expect(
          excluded.readLog.some((entry: string): boolean => {
            return entry.startsWith("dsx-app-logs");
          }),
        ).toBe(false);
      }, 120_000);

      test("reads at most maxTables indices and maxRowsPerTable documents, and says what it left", async () => {
        const limited: ContentScanResult = await sampleSearchStore(
          { kind: cluster.kind, connectionString: connectionOf(cluster) },
          scanOptions({ maxTables: 1, maxRowsPerTable: 5 }),
          {
            transport: createProbeSearchTransport(),
            readFrom: DataStorePostureReadFrom.Network,
          },
        );

        expect(limited.objectsRead).toBe(1);
        expect(limited.rowsRead).toBeLessThanOrEqual(5);
        expect(limited.isComplete).toBe(false);
        const notSampled: RegExp =
          /indices were not sampled: the scan reads at most 1 indices\.$/;

        expect(
          limited.warnings.some((warning: string): boolean => {
            return notSampled.test(warning);
          }),
        ).toBe(true);
      }, 120_000);

      if (cluster.security === "on") {
        test("a wrong password is refused with an error that never holds it", async () => {
          const wrong: string = "Wrong-Pass-For-Dsx-77";

          let message: string = "";

          try {
            await sampleSearchStore(
              {
                kind: cluster.kind,
                connectionString: connectionOf(cluster, { password: wrong }),
              },
              scanOptions(),
              {
                transport: createProbeSearchTransport(),
                readFrom: DataStorePostureReadFrom.Network,
              },
            );
          } catch (error) {
            message = (error as Error).message;
          }

          expect(message).toMatch(/^Could not connect to the cluster: /);
          expect(message).toContain("refused the user or API key");
          expect(message).not.toContain(wrong);
        }, 120_000);

        test("checks the certificate unless told not to", async () => {
          let message: string = "";

          try {
            await sampleSearchStore(
              {
                kind: cluster.kind,
                connectionString: connectionOf(cluster, { query: "" }),
              },
              scanOptions(),
              {
                transport: createProbeSearchTransport(),
                readFrom: DataStorePostureReadFrom.Network,
              },
            );
          } catch (error) {
            message = (error as Error).message;
          }

          expect(message).toMatch(/^Could not connect to the cluster: /);
          expect(message).not.toContain(READER_PASSWORD);
        }, 120_000);
      }

      if (cluster.security === "on" && cluster.engine === "elasticsearch") {
        test("signs in with an API key, as well as a user", async () => {
          const key: Answer = await must(
            cluster,
            "POST",
            "/_security/api_key",
            {
              name: "dsx-reader-key",
              role_descriptors: {
                dsx_reader: {
                  cluster: ["monitor"],
                  indices: [
                    {
                      names: ["*"],
                      privileges: ["read", "view_index_metadata", "monitor"],
                    },
                  ],
                },
              },
            },
          );
          const encoded: string = (key.json as Record<string, string>)[
            "encoded"
          ]!;
          const url: URL = new URL(cluster.url);
          const keyed: ContentScanResult = await sampleSearchStore(
            {
              kind: cluster.kind,
              connectionString: `${url.origin}?api_key=${encodeURIComponent(encoded)}&verify_certificate=false`,
            },
            scanOptions(),
            {
              transport: createProbeSearchTransport(),
              readFrom: DataStorePostureReadFrom.Network,
            },
          );

          expect(typesAt(keyed, "dsx-customers › ssn")).toContain("us-ssn");
          expect(JSON.stringify(keyed)).not.toContain(encoded);
        }, 120_000);

        if (cluster.ca) {
          test("checks the certificate against the cluster's own CA, given as JSON", async () => {
            const [user, password] = [READER, READER_PASSWORD];
            const verified: ContentScanResult = await sampleSearchStore(
              {
                kind: cluster.kind,
                connectionString: JSON.stringify({
                  url: cluster.url,
                  username: user,
                  password,
                  caCertificate: cluster.ca,
                }),
              },
              scanOptions(),
              {
                transport: createProbeSearchTransport(),
                readFrom: DataStorePostureReadFrom.Network,
              },
            );

            expect(typesAt(verified, "dsx-customers › email")).toContain(
              "email-address",
            );
          }, 120_000);
        }
      }
    });
  }
});
