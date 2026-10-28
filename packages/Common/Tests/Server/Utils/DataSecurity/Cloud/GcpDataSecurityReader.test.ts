import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { deflateRawSync } from "zlib";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
} from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import {
  BIGQUERY_READ_SCOPE,
  BigQuerySample,
  GCP_DATA_STORE_ASSET_TYPES,
  GCP_DATA_STORE_POLICY_ASSET_TYPES,
  GCS_READ_SCOPE,
  createGcsObjectStoreReader,
  readBigQuerySample,
  readGcpDataSecurity,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityReader";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { getDataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
  queryValues,
} from "../../LlmObservability/FakeProviderApi";

/*
 * Google Cloud's data stores against a fake Google OAuth, Cloud Asset
 * Inventory, Cloud Storage and BigQuery: each bucket's, Cloud SQL
 * instance's and dataset's configuration as posture facts, the IAM
 * bindings of a data role - on the store and inherited from the project -
 * as access entries, allUsers as public by its role, a member of another
 * project as external, a refused or turned-off API as null facts and one
 * warning, a refused key as a thrown error - and the content scanner's
 * reads: objects.list and ranged media downloads, and a sample of a
 * dataset's rows shaped by its schema.
 */

const PROJECT_ID: string = "acme-prod";
const DATA_PROJECT: string = "acme-data";
const NOW: Date = new Date("2026-10-27T12:00:00Z");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      ...config,
    },
    secrets: { serviceAccountJson: KEY },
  };
}

function bucketAsset(name: string, data: JSONObject): JSONObject {
  return {
    name: `//storage.googleapis.com/${name}`,
    assetType: "storage.googleapis.com/Bucket",
    resource: { version: "v1", data: { name, ...data } },
  };
}

function sqlAsset(name: string, data: JSONObject): JSONObject {
  return {
    name: `//cloudsql.googleapis.com/projects/${PROJECT_ID}/instances/${name}`,
    assetType: "sqladmin.googleapis.com/Instance",
    resource: { version: "v1beta4", data: { name, ...data } },
  };
}

function datasetAsset(datasetId: string, data: JSONObject): JSONObject {
  return {
    name: `//bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/${datasetId}`,
    assetType: "bigquery.googleapis.com/Dataset",
    resource: {
      version: "v2",
      data: {
        datasetReference: { projectId: PROJECT_ID, datasetId },
        ...data,
      },
    },
  };
}

function policy(
  name: string,
  assetType: string,
  bindings: Array<JSONObject>,
): JSONObject {
  return { name, assetType, iamPolicy: { version: 1, bindings } };
}

const RESOURCES: Array<JSONObject> = [
  bucketAsset("acme-public", {
    location: "US-CENTRAL1",
    locationType: "region",
    labels: { team: "data" },
    iamConfiguration: {
      uniformBucketLevelAccess: { enabled: true },
      publicAccessPrevention: "inherited",
    },
    encryption: {
      defaultKmsKeyName:
        "projects/acme-prod/locations/us/keyRings/data/cryptoKeys/buckets",
    },
    versioning: { enabled: true },
    // int64: written as a string.
    softDeletePolicy: { retentionDurationSeconds: "604800" },
    logging: { logBucket: "acme-access-logs" },
  }),
  bucketAsset("acme-private", {
    location: "NAM4",
    locationType: "dual-region",
    iamConfiguration: {
      uniformBucketLevelAccess: { enabled: false },
      publicAccessPrevention: "enforced",
    },
    // Public in its ACL, but public access prevention wins.
    acl: [{ entity: "allUsers", role: "READER" }],
    versioning: { enabled: false },
    softDeletePolicy: { retentionDurationSeconds: "0" },
  }),
  bucketAsset("acme-fine", {
    location: "EU",
    locationType: "dual-region",
    customPlacementConfig: { dataLocations: ["EUROPE-WEST1", "EUROPE-WEST4"] },
    iamConfiguration: {
      uniformBucketLevelAccess: { enabled: false },
      publicAccessPrevention: "inherited",
    },
    defaultObjectAcl: [
      { entity: "allUsers", role: "READER" },
      { entity: "project-owners-123456", role: "OWNER" },
    ],
  }),
  bucketAsset("acme-multi", {
    location: "US",
    locationType: "multi-region",
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
  }),
  sqlAsset("orders-db", {
    databaseVersion: "POSTGRES_15",
    region: "us-central1",
    instanceType: "CLOUD_SQL_INSTANCE",
    replicaNames: ["orders-replica"],
    diskEncryptionConfiguration: {
      kmsKeyName:
        "projects/acme-prod/locations/us-central1/keyRings/sql/cryptoKeys/orders",
    },
    settings: {
      userLabels: { app: "orders" },
      deletionProtectionEnabled: true,
      ipConfiguration: {
        ipv4Enabled: true,
        sslMode: "ENCRYPTED_ONLY",
        requireSsl: false,
        authorizedNetworks: [{ value: "0.0.0.0/0", name: "anywhere" }],
      },
      backupConfiguration: {
        enabled: true,
        pointInTimeRecoveryEnabled: true,
        backupRetentionSettings: {
          retentionUnit: "COUNT",
          retainedBackups: 14,
        },
      },
    },
  }),
  sqlAsset("orders-replica", {
    databaseVersion: "POSTGRES_15",
    region: "europe-west1",
    instanceType: "READ_REPLICA_INSTANCE",
    masterInstanceName: `${PROJECT_ID}:orders-db`,
    settings: {
      ipConfiguration: { ipv4Enabled: false, requireSsl: true },
      backupConfiguration: { enabled: false },
    },
  }),
  sqlAsset("shop-mysql", {
    databaseVersion: "MYSQL_8_0",
    region: "us-east1",
    settings: {
      ipConfiguration: {
        ipv4Enabled: true,
        sslMode: "ALLOW_UNENCRYPTED_AND_ENCRYPTED",
        authorizedNetworks: [{ value: "203.0.113.0/24" }],
      },
      backupConfiguration: { enabled: true, binaryLogEnabled: true },
    },
  }),
  datasetAsset("analytics", {
    location: "US",
    labels: { domain: "growth" },
    defaultEncryptionConfiguration: {
      kmsKeyName: "projects/acme-prod/locations/us/keyRings/bq/cryptoKeys/k",
    },
    access: [
      { role: "READER", specialGroup: "allAuthenticatedUsers" },
      { role: "OWNER", specialGroup: "projectOwners" },
      { role: "WRITER", userByEmail: "etl@acme-prod.iam.gserviceaccount.com" },
      {
        view: {
          projectId: "partner-co",
          datasetId: "shared",
          tableId: "v_orders",
        },
      },
    ],
  }),
  datasetAsset("raw", {
    location: "europe-west2",
    access: [{ role: "WRITER", iamMember: "allUsers" }],
  }),
];

const PROJECT_POLICY: JSONObject = policy(
  "//cloudresourcemanager.googleapis.com/projects/123456789012",
  "cloudresourcemanager.googleapis.com/Project",
  [
    { role: "roles/editor", members: ["user:dev@acme.com"] },
    {
      role: "roles/cloudsql.client",
      members: ["serviceAccount:app@acme-prod.iam.gserviceaccount.com"],
    },
    // Describes the project's resources, reads none of their data.
    { role: "roles/viewer", members: ["user:viewer@acme.com"] },
    {
      role: "roles/bigquery.dataViewer",
      members: ["serviceAccount:bi@analytics-vendor.iam.gserviceaccount.com"],
    },
  ],
);

const POLICIES: Array<JSONObject> = [
  PROJECT_POLICY,
  policy(
    "//storage.googleapis.com/acme-public",
    "storage.googleapis.com/Bucket",
    [
      { role: "roles/storage.objectViewer", members: ["allUsers"] },
      {
        role: "roles/storage.legacyBucketWriter",
        members: ["allAuthenticatedUsers"],
      },
      {
        role: "roles/storage.objectViewer",
        members: [
          "serviceAccount:etl@other-project.iam.gserviceaccount.com",
          // Google's own service agent: no other customer's.
          "serviceAccount:service-123456789012@gs-project-accounts.iam.gserviceaccount.com",
          "deleted:user:bob@acme.com?uid=123",
        ],
      },
      {
        role: "roles/storage.objectAdmin",
        members: ["serviceAccount:loader@acme-prod.iam.gserviceaccount.com"],
      },
      { role: "roles/storage.admin", members: ["user:alice@acme.com"] },
      {
        role: "roles/storage.legacyBucketReader",
        members: ["projectViewer:partner-project"],
      },
      // Not a data role.
      {
        role: "roles/storage.insightsCollectorService",
        members: ["user:carol@acme.com"],
      },
    ],
  ),
  policy(
    "//storage.googleapis.com/acme-private",
    "storage.googleapis.com/Bucket",
    [{ role: "roles/storage.objectViewer", members: ["allUsers"] }],
  ),
  policy(
    `//bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/analytics`,
    "bigquery.googleapis.com/Dataset",
    [
      // The access list's grant again, in IAM's words.
      {
        role: "roles/bigquery.dataViewer",
        members: ["allAuthenticatedUsers"],
      },
      {
        role: "roles/bigquery.dataEditor",
        members: ["group:analysts@acme.com"],
        condition: {
          title: "until year end",
          expression: "request.time < timestamp('2027-01-01T00:00:00Z')",
        },
      },
    ],
  ),
];

const DISABLED: FakeResponse = {
  status: 403,
  body: {
    error: {
      code: 403,
      message:
        "Cloud Asset API has not been used in project 123456789012 before or it is disabled.",
      status: "PERMISSION_DENIED",
    },
  },
};

const REFUSED: FakeResponse = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: "The caller does not have permission",
      status: "PERMISSION_DENIED",
    },
  },
};

interface FakeGcp extends FakeProviderApi {
  // The scope of every token asked for, in order.
  scopes: Array<string>;
}

function createFakeGcp(
  options: {
    resources?: Record<string, Array<JSONObject>>;
    policies?: Record<string, Array<JSONObject>>;
    // By "RESOURCE", "IAM_POLICY", or either with ":project".
    errors?: Record<string, FakeResponse>;
    tokenError?: FakeResponse;
    routes?: Array<FakeRoute>;
  } = {},
): FakeGcp {
  const scopes: Array<string> = [];
  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const assertion: string = String(
          (request.body as Dictionary<string>)["assertion"] || "",
        );
        const claims: { scope?: string } | null = jwt.decode(assertion) as {
          scope?: string;
        } | null;

        scopes.push(claims?.scope || "");

        return (
          options.tokenError ||
          json({ access_token: "ya29.token", expires_in: 3599 })
        );
      },
    },
    {
      host: "cloudasset.googleapis.com",
      path: /^\/v1\/projects\/[^/]+\/assets$/,
      method: "GET",
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const project: string = url.pathname.split("/")[3]!;
        const contentType: string = url.searchParams.get("contentType") || "";
        const failure: FakeResponse | undefined =
          options.errors?.[`${contentType}:${project}`] ||
          options.errors?.[contentType];

        if (failure) {
          return failure;
        }

        return json({
          assets:
            (contentType === "IAM_POLICY"
              ? options.policies?.[project]
              : options.resources?.[project]) || [],
        });
      },
    },
    ...(options.routes || []),
  ]);

  return { ...api, scopes };
}

const FULL: {
  resources: Record<string, Array<JSONObject>>;
  policies: Record<string, Array<JSONObject>>;
} = {
  resources: { [PROJECT_ID]: RESOURCES },
  policies: { [PROJECT_ID]: POLICIES },
};

async function readAll(
  api: FakeProviderApi,
  data: { settings?: CloudConnectionSettings; connected?: Array<string> } = {},
): Promise<CloudDataSecurityReadResult> {
  return await readGcpDataSecurity(data.settings || settings(), {
    projectId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    connectedProjectIds: data.connected || [PROJECT_ID, "acme-shared"],
    transport: api.transport,
    now: NOW,
  });
}

function storeNamed(
  result: CloudDataSecurityReadResult,
  name: string,
): CloudDataStoreRead {
  const found: CloudDataStoreRead | undefined = result.stores.find(
    (store: CloudDataStoreRead): boolean => {
      return store.identity.name === name;
    },
  );

  if (!found) {
    throw new Error(`No store ${name}`);
  }

  return found;
}

function entriesOf(
  store: CloudDataStoreRead,
  principal: string,
): Array<DataStoreAccessEntry> {
  return store.access.filter((entry: DataStoreAccessEntry): boolean => {
    return entry.principal === principal;
  });
}

describe("the listings", () => {
  test("two Cloud Asset listings a project, with a read-only token: the stores, then their IAM policies", async () => {
    const api: FakeGcp = createFakeGcp(FULL);
    await readAll(api);

    const listings: Array<URL> = api.requests
      .map((request: DataSourceHttpRequest): URL => {
        return new URL(request.url);
      })
      .filter((url: URL): boolean => {
        return url.host === "cloudasset.googleapis.com";
      });

    expect(listings).toHaveLength(2);
    expect(listings[0]!.pathname).toBe(`/v1/projects/${PROJECT_ID}/assets`);
    expect(listings[0]!.searchParams.get("contentType")).toBe("RESOURCE");
    expect(listings[0]!.searchParams.getAll("assetTypes")).toEqual([
      ...GCP_DATA_STORE_ASSET_TYPES,
    ]);
    expect(listings[1]!.searchParams.get("contentType")).toBe("IAM_POLICY");
    expect(listings[1]!.searchParams.getAll("assetTypes")).toEqual([
      "storage.googleapis.com/Bucket",
      "bigquery.googleapis.com/Dataset",
      "cloudresourcemanager.googleapis.com/Project",
    ]);
    expect([...GCP_DATA_STORE_POLICY_ASSET_TYPES]).not.toContain(
      "sqladmin.googleapis.com/Instance",
    );
    expect(api.scopes).toEqual([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
  });

  test("every store carries when it was read, its kind, project, region and labels", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );

    expect(
      result.stores.map((store: CloudDataStoreRead): string => {
        return `${store.identity.kind}: ${store.identity.name}`;
      }),
    ).toEqual([
      `${DataStoreKind.GcpStorageBucket}: acme-public`,
      `${DataStoreKind.GcpStorageBucket}: acme-private`,
      `${DataStoreKind.GcpStorageBucket}: acme-fine`,
      `${DataStoreKind.GcpStorageBucket}: acme-multi`,
      `${DataStoreKind.GcpCloudSqlInstance}: orders-db`,
      `${DataStoreKind.GcpCloudSqlInstance}: orders-replica`,
      `${DataStoreKind.GcpCloudSqlInstance}: shop-mysql`,
      `${DataStoreKind.GcpBigQueryDataset}: analytics`,
      `${DataStoreKind.GcpBigQueryDataset}: raw`,
    ]);

    for (const store of result.stores) {
      expect(store.posture.readAt).toBe(NOW.toISOString());
      expect(store.identity.accountNumber).toBe(PROJECT_ID);
    }

    const bucket: CloudDataStoreRead = storeNamed(result, "acme-public");
    expect(bucket.identity.providerResourceId).toBe(
      "//storage.googleapis.com/acme-public",
    );
    expect(bucket.identity.region).toBe("us-central1");
    expect(bucket.tags).toEqual({ team: "data" });
    expect(storeNamed(result, "orders-db").tags).toEqual({ app: "orders" });
    expect(storeNamed(result, "analytics").identity.providerResourceId).toBe(
      `//bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/analytics`,
    );
    expect(result.warnings).toEqual([]);
    expect(result.complete).toBe(true);
  });

  test("a project without stores is not asked for its policies", async () => {
    const api: FakeGcp = createFakeGcp({ resources: { [PROJECT_ID]: [] } });
    const result: CloudDataSecurityReadResult = await readAll(api);

    expect(result.stores).toEqual([]);
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return queryValues(request, "contentType")[0] === "IAM_POLICY";
      }),
    ).toHaveLength(0);
  });
});

describe("buckets", () => {
  test("allUsers to read and allAuthenticatedUsers to write make a bucket public both ways; its settings are its facts", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acme-public",
    ).posture;

    expect(posture.publicRead).toBe(true);
    expect(posture.publicWrite).toBe(true);
    expect(posture.publicReason).toContain(
      "allUsers has roles/storage.objectViewer",
    );
    expect(posture.publicReason).toContain(
      "allAuthenticatedUsers has roles/storage.legacyBucketWriter",
    );
    expect(posture.blockPublicAccess).toBe(false);
    expect(posture.uniformAccess).toBe(true);
    expect(posture.customerManagedKey).toBe(true);
    expect(posture.versioning).toBe(true);
    expect(posture.softDelete).toBe(true);
    expect(posture.accessLogging).toBe(true);
    expect(posture.replicationRegions).toEqual([]);
    expect(getDataStoreExposure(posture)).toBe("Public");
  });

  test("public access prevention makes every public grant - IAM or ACL - do nothing", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const bucket: CloudDataStoreRead = storeNamed(result, "acme-private");

    expect(bucket.posture.blockPublicAccess).toBe(true);
    expect(bucket.posture.publicRead).toBe(false);
    expect(bucket.posture.publicWrite).toBe(false);
    expect(bucket.posture.publicReason).toBeUndefined();
    expect(entriesOf(bucket, "allUsers")).toEqual([]);
    expect(bucket.posture.uniformAccess).toBe(false);
    expect(bucket.posture.versioning).toBe(false);
    expect(bucket.posture.softDelete).toBe(false);
    expect(bucket.posture.accessLogging).toBe(false);
    expect(bucket.posture.customerManagedKey).toBe(false);
    // A predefined dual-region: its two regions.
    expect(bucket.posture.replicationRegions).toEqual([
      "us-central1",
      "us-east1",
    ]);
  });

  test("a fine-grained bucket answers to its ACLs too: allUsers in its default object ACL is public", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const bucket: CloudDataStoreRead = storeNamed(result, "acme-fine");

    expect(bucket.posture.publicRead).toBe(true);
    expect(bucket.posture.publicWrite).toBe(false);
    expect(bucket.posture.publicReason).toContain(
      "allUsers has READER in its default object acl",
    );
    expect(entriesOf(bucket, "allUsers")).toEqual([
      expect.objectContaining({
        grantedVia: "Default object ACL: READER",
        isPublic: true,
        principalType: DataStorePrincipalType.Public,
      }),
    ]);
    // A custom dual-region: the regions it names.
    expect(bucket.posture.replicationRegions).toEqual([
      "europe-west1",
      "europe-west4",
    ]);
    expect(storeNamed(result, "acme-multi").posture.replicationRegions).toEqual(
      ["us"],
    );
  });

  test("members of projects outside the connected ones are external and share the bucket; Google's service agents and our own are not", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const bucket: CloudDataStoreRead = storeNamed(result, "acme-public");

    expect(bucket.posture.sharedWithExternal).toEqual([
      "other-project",
      "partner-project",
    ]);
    expect(
      entriesOf(
        bucket,
        "serviceAccount:etl@other-project.iam.gserviceaccount.com",
      ),
    ).toEqual([
      {
        principal: "serviceAccount:etl@other-project.iam.gserviceaccount.com",
        principalName: "etl@other-project.iam.gserviceaccount.com",
        principalType: DataStorePrincipalType.ServiceAccount,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "IAM: roles/storage.objectViewer",
        isExternal: true,
        isPublic: false,
      },
    ]);
    expect(
      entriesOf(
        bucket,
        "serviceAccount:service-123456789012@gs-project-accounts.iam.gserviceaccount.com",
      )[0]!.isExternal,
    ).toBe(false);
    expect(
      entriesOf(
        bucket,
        "serviceAccount:loader@acme-prod.iam.gserviceaccount.com",
      ),
    ).toEqual([
      expect.objectContaining({
        accessLevel: DataStoreAccessLevel.Write,
        isExternal: false,
      }),
    ]);
    expect(entriesOf(bucket, "projectViewer:partner-project")).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.Role,
        isExternal: true,
      }),
    ]);
    expect(entriesOf(bucket, "user:alice@acme.com")).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.User,
        accessLevel: DataStoreAccessLevel.Admin,
      }),
    ]);
    // A role that reads no data, and a deleted member, are no entries.
    expect(entriesOf(bucket, "user:carol@acme.com")).toEqual([]);
    expect(
      bucket.access.some((entry: DataStoreAccessEntry): boolean => {
        return entry.principal.startsWith("deleted:");
      }),
    ).toBe(false);
    expect(entriesOf(bucket, "allUsers")).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.Public,
        principalName: "Anyone on the internet",
        accessLevel: DataStoreAccessLevel.Read,
        isPublic: true,
        isExternal: true,
      }),
    ]);
  });
});

describe("the project's own policy", () => {
  test("its data roles reach every store they apply to, inherited; a role that only describes reaches none", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );

    for (const name of ["acme-public", "orders-db", "analytics"]) {
      expect(entriesOf(storeNamed(result, name), "user:dev@acme.com")).toEqual([
        expect.objectContaining({
          accessLevel: DataStoreAccessLevel.Write,
          grantedVia: "Project IAM: roles/editor",
        }),
      ]);
      expect(
        entriesOf(storeNamed(result, name), "user:viewer@acme.com"),
      ).toEqual([]);
    }

    const app: string = "serviceAccount:app@acme-prod.iam.gserviceaccount.com";
    expect(entriesOf(storeNamed(result, "orders-db"), app)).toEqual([
      expect.objectContaining({
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "Project IAM: roles/cloudsql.client",
      }),
    ]);
    expect(entriesOf(storeNamed(result, "acme-public"), app)).toEqual([]);
    expect(storeNamed(result, "orders-db").posture.sharedWithExternal).toEqual(
      [],
    );
  });
});

describe("Cloud SQL instances", () => {
  test("a public IP open to 0.0.0.0/0, TLS required, backups with point-in-time recovery, deletion protection, its key and its replica's region", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "orders-db",
    ).posture;

    expect(posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: true,
        openToAllAddresses: true,
        encryptionInTransitEnforced: true,
        backupsEnabled: true,
        backupRetentionDays: 14,
        pointInTimeRecovery: true,
        deletionProtection: true,
        customerManagedKey: true,
        replicationRegions: ["europe-west1"],
      }),
    );
    expect(storeNamed(result, "orders-db").identity.region).toBe("us-central1");
  });

  test("a replica on a private IP that requires TLS; MySQL's binary log is its point-in-time recovery, and plain connections are not encryption", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );

    expect(storeNamed(result, "orders-replica").posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: false,
        openToAllAddresses: false,
        encryptionInTransitEnforced: true,
        backupsEnabled: false,
        pointInTimeRecovery: false,
        deletionProtection: false,
        customerManagedKey: false,
        replicationRegions: [],
      }),
    );
    expect(storeNamed(result, "shop-mysql").posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: true,
        openToAllAddresses: false,
        encryptionInTransitEnforced: false,
        pointInTimeRecovery: true,
      }),
    );
  });
});

describe("BigQuery datasets", () => {
  test("allAuthenticatedUsers in its access list is public; an authorized view of another project shares it; its key and location", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const dataset: CloudDataStoreRead = storeNamed(result, "analytics");

    expect(dataset.posture.publicRead).toBe(true);
    expect(dataset.posture.publicWrite).toBe(false);
    expect(dataset.posture.publicReason).toContain(
      "allAuthenticatedUsers has READER",
    );
    expect(dataset.posture.customerManagedKey).toBe(true);
    expect(dataset.posture.replicationRegions).toEqual(["us"]);
    expect(dataset.identity.region).toBe("us");
    expect(dataset.posture.sharedWithExternal).toEqual([
      "partner-co",
      "analytics-vendor",
    ]);
    expect(entriesOf(dataset, "view:partner-co.shared.v_orders")).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.Service,
        accessLevel: DataStoreAccessLevel.Read,
        isExternal: true,
      }),
    ]);
    expect(
      entriesOf(
        dataset,
        "serviceAccount:etl@acme-prod.iam.gserviceaccount.com",
      ),
    ).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.ServiceAccount,
        accessLevel: DataStoreAccessLevel.Write,
        grantedVia: "Dataset access: WRITER",
      }),
    ]);
    expect(entriesOf(dataset, `projectOwner:${PROJECT_ID}`)).toEqual([
      expect.objectContaining({
        principalType: DataStorePrincipalType.Role,
        accessLevel: DataStoreAccessLevel.Admin,
        isExternal: false,
      }),
    ]);
    // Its access list and its IAM policy say one grant twice: kept once.
    expect(entriesOf(dataset, "allAuthenticatedUsers")).toHaveLength(1);
    expect(entriesOf(dataset, "group:analysts@acme.com")).toEqual([
      expect.objectContaining({
        grantedVia: "IAM: roles/bigquery.dataEditor (conditional)",
      }),
    ]);
  });

  test("allUsers as a writer makes a dataset public to write; a single region is copied nowhere", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp(FULL),
    );
    const raw: CloudDataStoreRead = storeNamed(result, "raw");

    expect(raw.posture.publicWrite).toBe(true);
    expect(raw.posture.publicRead).toBe(true);
    expect(raw.posture.customerManagedKey).toBe(false);
    expect(raw.posture.replicationRegions).toEqual([]);
  });
});

describe("what Google Cloud refuses", () => {
  test("refused IAM policies leave public access unknown - unless the bucket itself settles it - and are said once", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp({ ...FULL, errors: { IAM_POLICY: REFUSED } }),
    );

    expect(storeNamed(result, "acme-public").posture.publicRead).toBeNull();
    expect(storeNamed(result, "acme-public").posture.publicWrite).toBeNull();
    expect(
      storeNamed(result, "acme-public").posture.sharedWithExternal,
    ).toBeUndefined();
    expect(storeNamed(result, "acme-public").posture.readWarnings).toEqual([
      "Could not read who has access to it: its IAM policy was not read.",
    ]);
    // Public access prevention settles it; an ACL says it outright.
    expect(storeNamed(result, "acme-private").posture.publicRead).toBe(false);
    expect(storeNamed(result, "acme-fine").posture.publicRead).toBe(true);
    // A dataset's own access list still says who reaches it.
    expect(storeNamed(result, "analytics").posture.publicRead).toBe(true);
    expect(storeNamed(result, "orders-db").access).toEqual([]);
    // What the stores' own configuration says is still said.
    expect(storeNamed(result, "acme-public").posture.versioning).toBe(true);
    expect(result.warnings).toEqual([
      `The service account may not read the IAM policies of ${PROJECT_ID}: give it the Cloud Asset Viewer (roles/cloudasset.viewer) role.`,
    ]);
  });

  test("a project whose Cloud Asset API is off is a warning with the command that turns it on; the other projects are read", async () => {
    const api: FakeGcp = createFakeGcp({
      resources: { [PROJECT_ID]: RESOURCES, [DATA_PROJECT]: [] },
      policies: { [PROJECT_ID]: POLICIES },
      errors: { [`RESOURCE:${DATA_PROJECT}`]: DISABLED },
    });
    const result: CloudDataSecurityReadResult = await readAll(api, {
      settings: settings({ projectIds: `${PROJECT_ID}, ${DATA_PROJECT}` }),
    });

    expect(result.stores).toHaveLength(RESOURCES.length);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      `The Cloud Asset API is turned off in ${DATA_PROJECT}, so the data stores there were not read. Turn it on: gcloud services enable cloudasset.googleapis.com --project ${DATA_PROJECT}`,
    ]);
  });

  test("the same refusal in several projects is one warning naming them", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeGcp({ errors: { RESOURCE: REFUSED } }),
      { settings: settings({ projectIds: `${PROJECT_ID}, ${DATA_PROJECT}` }) },
    );

    expect(result.stores).toEqual([]);
    expect(result.warnings).toEqual([
      `The service account may not read the data stores of ${PROJECT_ID}, ${DATA_PROJECT}: give it the Cloud Asset Viewer (roles/cloudasset.viewer) role.`,
    ]);
  });

  test("a refused key is thrown, not a warning", async () => {
    const failure: unknown = await readAll(
      createFakeGcp({
        ...FULL,
        tokenError: {
          status: 400,
          body: { error: "invalid_grant", error_description: "Invalid JWT" },
        },
      }),
    ).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });
});

describe("Cloud Storage objects", () => {
  const LIST_URL_PATH: string = "/storage/v1/b/acme-public/o";

  function gcs(routes: Array<FakeRoute>): FakeGcp {
    return createFakeGcp({ routes });
  }

  function reader(
    api: FakeProviderApi,
    bucket: string = "acme-public",
  ): ObjectStoreReader {
    return createGcsObjectStoreReader(settings(), {
      connectionId: "22222222-2222-4222-8222-222222222222",
      bucket,
      transport: api.transport,
    });
  }

  test("objects.list: names, sizes and dates - none of their metadata - with a devstorage.read_only token", async () => {
    const api: FakeGcp = gcs([
      {
        host: "storage.googleapis.com",
        path: LIST_URL_PATH,
        respond: (): FakeResponse => {
          return json({
            items: [
              {
                name: "exports/users.csv",
                size: "2048",
                updated: "2026-10-21T10:00:00.000Z",
                etag: "CJi0",
              },
              { name: "exports/empty.txt", size: "0" },
            ],
            nextPageToken: "next-page",
          });
        },
      },
    ]);
    const store: ObjectStoreReader = reader(api);
    const page: ObjectStoreListPage = await store.listObjects({
      prefix: "exports/",
      nextToken: "this-page",
      maxKeys: 5000,
    });

    expect(store.description).toBe("gs://acme-public");
    expect(page).toEqual({
      objects: [
        {
          key: "exports/users.csv",
          sizeInBytes: 2048,
          lastModified: new Date("2026-10-21T10:00:00.000Z"),
          etag: "CJi0",
        },
        {
          key: "exports/empty.txt",
          sizeInBytes: 0,
          lastModified: undefined,
          etag: undefined,
        },
      ],
      nextToken: "next-page",
    });

    const listing: DataSourceHttpRequest = api.requestsTo(LIST_URL_PATH)[0]!;

    expect(queryValues(listing, "prefix")).toEqual(["exports/"]);
    expect(queryValues(listing, "pageToken")).toEqual(["this-page"]);
    // Cloud Storage's own page limit.
    expect(queryValues(listing, "maxResults")).toEqual(["1000"]);
    expect(queryValues(listing, "fields")).toEqual([
      "items(name,size,updated,etag),nextPageToken",
    ]);
    expect(listing.headers?.["Authorization"]).toBe("Bearer ya29.token");
    expect(api.scopes).toEqual([GCS_READ_SCOPE]);
  });

  test("a media download with a Range header, the object's name one encoded segment", async () => {
    const api: FakeGcp = gcs([
      {
        host: "storage.googleapis.com",
        path: /^\/storage\/v1\/b\/acme-public\/o\/.+$/,
        respond: (): FakeResponse => {
          return { body: "name,email\nada,ada@example.com\n" };
        },
      },
    ]);
    const bytes: Uint8Array = await reader(api).readObjectStart(
      "exports/2026 users.csv",
      16,
    );
    const read: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "storage.googleapis.com";
      },
    )!;
    const url: URL = new URL(read.url);

    expect(url.pathname).toBe(
      "/storage/v1/b/acme-public/o/exports%2F2026%20users.csv",
    );
    expect(url.searchParams.get("alt")).toBe("media");
    expect(read.headers?.["Range"]).toBe("bytes=0-15");
    // This fake keeps no bytes: the read falls back to its text's UTF-8.
    expect(read.keepBodyBytes).toBe(true);
    expect(Buffer.from(bytes).toString("utf8")).toBe("name,email\nada,a");
  });

  test("a zip comes back byte for byte when the transport keeps its bytes, held to the range; listings stay text", async () => {
    // A zip's local file header, then bytes no UTF-8 decoder keeps.
    const zip: Buffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00]),
      Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0x80]),
      deflateRawSync(Buffer.from("name,email\nada,ada@example.com\n", "utf8")),
    ]);
    expect(Buffer.from(zip.toString("utf8"), "utf8").equals(zip)).toBe(false);

    const api: FakeGcp = gcs([
      {
        host: "storage.googleapis.com",
        path: LIST_URL_PATH,
        respond: (): FakeResponse => {
          return json({ items: [{ name: "exports.zip", size: "64" }] });
        },
      },
    ]);
    const reads: Array<DataSourceHttpRequest> = [];
    const transport: CloudConnectorTransport = async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (new URL(request.url).searchParams.get("alt") === "media") {
        reads.push(request);

        return {
          statusCode: 206,
          bodyText: zip.toString("utf8"),
          bodyBytes: zip,
          bodyJson: undefined,
          headers: {},
        };
      }

      return await api.transport(request);
    };
    const store: ObjectStoreReader = createGcsObjectStoreReader(settings(), {
      connectionId: "22222222-2222-4222-8222-222222222222",
      bucket: "acme-public",
      transport,
    });

    const whole: Uint8Array = await store.readObjectStart(
      "exports.zip",
      zip.length,
    );
    const start: Uint8Array = await store.readObjectStart("exports.zip", 6);

    expect(Buffer.from(whole).equals(zip)).toBe(true);
    expect(Buffer.from(start).equals(zip.subarray(0, 6))).toBe(true);
    expect(
      reads.map((request: DataSourceHttpRequest): unknown => {
        return request.keepBodyBytes;
      }),
    ).toEqual([true, true]);

    await store.listObjects({ maxKeys: 10 });

    expect(api.requestsTo(LIST_URL_PATH)[0]!.keepBodyBytes).toBeUndefined();
  });

  test("an empty object is no bytes; a refused read is thrown for the sampler to record", async () => {
    const empty: FakeGcp = gcs([
      {
        host: "storage.googleapis.com",
        path: /^\/storage\/v1\/b\/acme-public\/o\/.+$/,
        respond: (): FakeResponse => {
          return { status: 416, body: "Requested range not satisfiable" };
        },
      },
    ]);
    expect((await reader(empty).readObjectStart("empty.txt", 100)).length).toBe(
      0,
    );

    const refused: FakeGcp = gcs([
      {
        host: "storage.googleapis.com",
        path: /^\/storage\/v1\/b\/acme-public\/o\/.+$/,
        respond: (): FakeResponse => {
          return REFUSED;
        },
      },
    ]);
    const failure: unknown = await reader(refused)
      .readObjectStart("secret.csv", 100)
      .catch((error: unknown) => {
        return error;
      });

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
  });

  test("the host is Google's own: a bucket's name that is not one is refused before a request", async () => {
    const api: FakeGcp = gcs([]);

    for (const bucket of [
      "evil.example.com/x",
      "Acme-Public",
      "ab",
      "acme public",
      "-acme",
      "acme?alt=media",
    ]) {
      expect(() => {
        return reader(api, bucket);
      }).toThrow(BadDataException);
    }

    await expect(reader(api).readObjectStart("..", 10)).rejects.toThrow(
      BadDataException,
    );
    expect(api.requests).toHaveLength(0);
  });
});

describe("a dataset's sample", () => {
  const TABLES_PATH: string = `/bigquery/v2/projects/${PROJECT_ID}/datasets/analytics/tables`;

  const USERS_SCHEMA: JSONObject = {
    schema: {
      fields: [
        { name: "id", type: "INTEGER", mode: "REQUIRED" },
        { name: "email", type: "STRING" },
        {
          name: "address",
          type: "RECORD",
          fields: [
            { name: "street", type: "STRING" },
            { name: "city", type: "STRING" },
          ],
        },
        { name: "tags", type: "STRING", mode: "REPEATED" },
        { name: "__proto__", type: "STRING" },
        {
          name: "contacts",
          type: "RECORD",
          mode: "REPEATED",
          fields: [
            { name: "kind", type: "STRING" },
            { name: "value", type: "STRING" },
          ],
        },
      ],
    },
  };

  const USERS_ROWS: JSONObject = {
    totalRows: "2",
    rows: [
      {
        f: [
          { v: "1" },
          { v: "ada@example.com" },
          { v: { f: [{ v: "1 Main St" }, { v: "Springfield" }] } },
          { v: [{ v: "vip" }, { v: "beta" }] },
          { v: "not a prototype" },
          { v: [{ v: { f: [{ v: "phone" }, { v: "+1 555 0100" }] } }] },
        ],
      },
      {
        f: [
          { v: "2" },
          { v: null },
          { v: null },
          { v: [] },
          { v: null },
          { v: [] },
        ],
      },
    ],
  };

  function bigQuery(): FakeGcp {
    return createFakeGcp({
      routes: [
        {
          host: "bigquery.googleapis.com",
          path: TABLES_PATH,
          respond: (): FakeResponse => {
            return json({
              tables: [
                { tableReference: { tableId: "users" }, type: "TABLE" },
                { tableReference: { tableId: "v_users" }, type: "VIEW" },
                { tableReference: { tableId: "orders" }, type: "TABLE" },
                { tableReference: { tableId: "events" }, type: "TABLE" },
              ],
            });
          },
        },
        {
          host: "bigquery.googleapis.com",
          path: `${TABLES_PATH}/users`,
          respond: (): FakeResponse => {
            return json(USERS_SCHEMA);
          },
        },
        {
          host: "bigquery.googleapis.com",
          path: `${TABLES_PATH}/users/data`,
          respond: (): FakeResponse => {
            return json(USERS_ROWS);
          },
        },
        {
          host: "bigquery.googleapis.com",
          path: `${TABLES_PATH}/orders`,
          respond: (): FakeResponse => {
            return {
              status: 403,
              body: {
                error: {
                  code: 403,
                  message:
                    "Access Denied: BigQuery BigQuery: User does not have permission to access policy tag.",
                },
              },
            };
          },
        },
      ],
    });
  }

  async function sample(api: FakeProviderApi): Promise<BigQuerySample> {
    return await readBigQuerySample(settings(), {
      connectionId: "22222222-2222-4222-8222-222222222222",
      projectId: PROJECT_ID,
      datasetId: "analytics",
      maxTables: 2,
      maxRowsPerTable: 5,
      transport: api.transport,
    });
  }

  test("rows keyed by column, RECORDs as objects and REPEATED columns as lists, with a bigquery.readonly token", async () => {
    const api: FakeGcp = bigQuery();
    const result: BigQuerySample = await sample(api);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.table).toBe("users");
    expect(result.tables[0]!.columns).toEqual([
      "id",
      "email",
      "address",
      "tags",
      "__proto__",
      "contacts",
    ]);

    const first: Record<string, unknown> = result.tables[0]!.rows[0]!;

    expect(first["id"]).toBe("1");
    expect(first["email"]).toBe("ada@example.com");
    expect(first["address"]).toEqual({
      street: "1 Main St",
      city: "Springfield",
    });
    expect(first["tags"]).toEqual(["vip", "beta"]);
    expect(first["contacts"]).toEqual([
      { kind: "phone", value: "+1 555 0100" },
    ]);
    // A column named __proto__ is a column, not the row's prototype.
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Object.keys(first)).toContain("__proto__");
    expect(result.tables[0]!.rows[1]).toEqual({
      id: "2",
      email: null,
      address: null,
      tags: [],
      contacts: [],
      ["__proto__"]: null,
    });
    expect(api.scopes).toEqual([BIGQUERY_READ_SCOPE]);

    const data: DataSourceHttpRequest = api.requestsTo(
      `${TABLES_PATH}/users/data`,
    )[0]!;
    expect(queryValues(data, "maxResults")).toEqual(["5"]);
  });

  test("only tables are read, at most maxTables; a table that refuses is a warning, and so is what was left", async () => {
    const api: FakeGcp = bigQuery();
    const result: BigQuerySample = await sample(api);

    expect(api.requestsTo(`${TABLES_PATH}/v_users`)).toHaveLength(0);
    expect(api.requestsTo(`${TABLES_PATH}/events`)).toHaveLength(0);
    expect(result.warnings).toEqual([
      expect.stringContaining(
        `Could not read table orders of ${PROJECT_ID}.analytics`,
      ),
      `${PROJECT_ID}.analytics has more tables than one sample reads: the first 2 were read.`,
    ]);
  });

  test("a dataset id that is not one is refused before a request", async () => {
    const api: FakeGcp = bigQuery();

    await expect(
      readBigQuerySample(settings(), {
        connectionId: "x",
        projectId: PROJECT_ID,
        datasetId: "analytics/../other",
        maxTables: 1,
        maxRowsPerTable: 1,
        transport: api.transport,
      }),
    ).rejects.toThrow(BadDataException);
    expect(api.requests).toHaveLength(0);
  });
});
