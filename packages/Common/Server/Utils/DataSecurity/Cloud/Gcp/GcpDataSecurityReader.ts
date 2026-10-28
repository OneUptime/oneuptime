import { normalizeCloudTags } from "../../../../../Types/Cloud/CloudInventory";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureFacts } from "../../../../../Types/DataSecurity/DataStorePosture";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  getOrganizationLimitWarning,
  readCloudSetting,
} from "../../../CloudConnection/CloudConnectorTypes";
import { withCloudRetries } from "../../../CloudConnection/CloudRetry";
import GcpCloudConnector from "../../../CloudConnection/Gcp/GcpCloudConnector";
import GcpInventoryClient, {
  GCP_CLOUD_PLATFORM_READ_SCOPE,
} from "../../../CloudConnection/Gcp/GcpInventory";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import GoogleMonitoringClient from "../../../LlmObservability/Connectors/GoogleVertexAI/GoogleMonitoringClient";
import GoogleServiceAccountToken from "../../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../../LlmObservability/LlmProviderHttp";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreObject,
  ObjectStoreReader,
} from "../DataSecurityCloudTypes";

/*
 * GOOGLE CLOUD'S DATA STORES, FOR DATA SECURITY.
 *
 * Every Cloud Storage bucket, Cloud SQL instance and BigQuery dataset of
 * the connection's projects, from Cloud Asset Inventory - two listings a
 * project, as the connection's service account with the Cloud Asset
 * Viewer role it already has:
 *
 *   GET https://cloudasset.googleapis.com/v1/projects/{project}/assets
 *       ?contentType=RESOURCE&assetTypes=<buckets, instances, datasets>
 *       -> each store's configuration as its own API writes it
 *          (resource.data)
 *   GET ...?contentType=IAM_POLICY&assetTypes=<buckets, datasets, project>
 *       -> who holds which role on each, and on the project every store
 *          inherits from (Cloud SQL has no policy of its own)
 *
 * The configuration becomes posture facts; the bindings of a data role
 * become access entries. allUsers and allAuthenticatedUsers make a store
 * public, to read or to write by the role; a member of a project outside
 * the connected ones shares the store with that project. What a project
 * will not give - a missing role, its Cloud Asset API turned off - leaves
 * the facts it holds null and is one warning per listing, naming the
 * projects; a refused key stops the read.
 *
 * The content scanner reads a bucket's objects (createGcsObjectStoreReader)
 * and a dataset's tables (readBigQuerySample) with tokens of narrow
 * read-only scopes of their own - devstorage.read_only and
 * bigquery.readonly - which need roles besides: Storage Object Viewer and
 * BigQuery Data Viewer.
 */

const ASSET_PROVIDER_TITLE: string = "Google Cloud Asset Inventory";
const STORAGE_PROVIDER_TITLE: string = "Google Cloud Storage";
const BIGQUERY_PROVIDER_TITLE: string = "Google BigQuery";
const ASSET_BASE_URL: string = "https://cloudasset.googleapis.com/v1";
const STORAGE_BASE_URL: string = "https://storage.googleapis.com/storage/v1";
const BIGQUERY_BASE_URL: string = "https://bigquery.googleapis.com/bigquery/v2";
const CLOUD_ASSET_SERVICE: string = "cloudasset.googleapis.com";
const STORAGE_SERVICE: string = "storage.googleapis.com";
const BIGQUERY_SERVICE: string = "bigquery.googleapis.com";

// The narrowest scopes that list and read a bucket's objects and a dataset's rows.
export const GCS_READ_SCOPE: string =
  "https://www.googleapis.com/auth/devstorage.read_only";
export const BIGQUERY_READ_SCOPE: string =
  "https://www.googleapis.com/auth/bigquery.readonly";

const BUCKET_TYPE: string = "storage.googleapis.com/Bucket";
const SQL_INSTANCE_TYPE: string = "sqladmin.googleapis.com/Instance";
const DATASET_TYPE: string = "bigquery.googleapis.com/Dataset";
const PROJECT_TYPE: string = "cloudresourcemanager.googleapis.com/Project";

export const GCP_DATA_STORE_ASSET_TYPES: ReadonlyArray<string> = [
  BUCKET_TYPE,
  SQL_INSTANCE_TYPE,
  DATASET_TYPE,
];
// Cloud SQL instances have no IAM policy: who reaches them is the project's.
export const GCP_DATA_STORE_POLICY_ASSET_TYPES: ReadonlyArray<string> = [
  BUCKET_TYPE,
  DATASET_TYPE,
  PROJECT_TYPE,
];

const ASSET_PAGE_SIZE: number = 1000;
const ASSET_MAX_PAGES: number = 20;
// Access entries one store keeps at most.
const MAX_ACCESS_ENTRIES: number = 500;
// Places a warning names before "and N more".
const MAX_WARNING_PLACES: number = 5;
// A page of objects.list at most: Cloud Storage's own limit.
const GCS_LIST_MAX_RESULTS: number = 1000;
// Cloud Storage caps an object's name at 1,024 bytes.
const MAX_OBJECT_NAME_BYTES: number = 1024;
const BIGQUERY_TABLE_PAGE_SIZE: number = 1000;
const BIGQUERY_TABLE_MAX_PAGES: number = 10;
const BIGQUERY_ROW_MAX_PAGES: number = 5;
const BIGQUERY_MAX_TABLES: number = 1000;
const BIGQUERY_MAX_ROWS_PER_TABLE: number = 10000;
// BigQuery nests RECORD fields 15 deep at most.
const BIGQUERY_MAX_DEPTH: number = 15;
// What the projects of an organization connection are searched with, when the caller gives no budget.
const PROJECT_SEARCH_MAX_REQUESTS: number = 50;
const PROJECT_SEARCH_MAX_DURATION_MS: number = 5 * 60 * 1000;

// A bucket's name: lowercase letters, digits, dots, hyphens and underscores, 3 to 222 characters.
const BUCKET_NAME_REGEX: RegExp = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
// A dataset's id: letters, digits and underscores.
const DATASET_ID_REGEX: RegExp = /^[A-Za-z0-9_]{1,1024}$/;
/*
 * Google's own service agents are named by the project's number:
 * service-123@..., 123-compute@developer..., 123@cloudservices...
 */
const SERVICE_AGENT_REGEX: RegExp = /^(?:service-)?[0-9]/;
const IAM_SERVICE_ACCOUNT_SUFFIX: string = ".iam.gserviceaccount.com";
const APP_ENGINE_SERVICE_ACCOUNT_DOMAIN: string = "appspot.gserviceaccount.com";

// The predefined dual-regions and the two regions each holds the data in.
const GCS_DUAL_REGIONS: ReadonlyMap<string, Array<string>> = new Map<
  string,
  Array<string>
>([
  ["nam4", ["us-central1", "us-east1"]],
  ["eur4", ["europe-north1", "europe-west4"]],
  ["asia1", ["asia-northeast1", "asia-northeast2"]],
]);
const BIGQUERY_MULTI_REGIONS: ReadonlySet<string> = new Set<string>([
  "us",
  "eu",
]);

/*
 * The roles that reach a store's data, and whether each reads (or lists)
 * it and writes it: what makes a binding of allUsers public to read or to
 * write. Roles that only describe a store (Storage Legacy... are data
 * roles; roles/cloudsql.viewer and roles/bigquery.metadataViewer are not)
 * are left out.
 */
interface GcpDataRole {
  level: DataStoreAccessLevel;
  reads: boolean;
  writes: boolean;
}

function gcpRole(
  level: DataStoreAccessLevel,
  reads: boolean,
  writes: boolean,
): GcpDataRole {
  return { level, reads, writes };
}

const READS: GcpDataRole = gcpRole(DataStoreAccessLevel.Read, true, false);
const WRITES_ONLY: GcpDataRole = gcpRole(
  DataStoreAccessLevel.Write,
  false,
  true,
);
const READS_AND_WRITES: GcpDataRole = gcpRole(
  DataStoreAccessLevel.Write,
  true,
  true,
);
const ADMINISTERS: GcpDataRole = gcpRole(
  DataStoreAccessLevel.Admin,
  true,
  true,
);

const BASIC_ROLES: Array<[string, GcpDataRole]> = [
  ["roles/owner", ADMINISTERS],
  ["roles/editor", READS_AND_WRITES],
];

const BUCKET_ROLES: ReadonlyMap<string, GcpDataRole> = new Map<
  string,
  GcpDataRole
>([
  ["roles/storage.objectViewer", READS],
  ["roles/storage.legacyObjectReader", READS],
  // Lists the objects: their names are data too.
  ["roles/storage.legacyBucketReader", READS],
  ["roles/storage.objectCreator", WRITES_ONLY],
  ["roles/storage.objectUser", READS_AND_WRITES],
  ["roles/storage.objectAdmin", READS_AND_WRITES],
  ["roles/storage.legacyBucketWriter", READS_AND_WRITES],
  ["roles/storage.legacyObjectOwner", READS_AND_WRITES],
  ["roles/storage.legacyBucketOwner", ADMINISTERS],
  ["roles/storage.admin", ADMINISTERS],
  ...BASIC_ROLES,
]);

const SQL_ROLES: ReadonlyMap<string, GcpDataRole> = new Map<
  string,
  GcpDataRole
>([
  ["roles/cloudsql.client", READS],
  ["roles/cloudsql.instanceUser", READS],
  ["roles/cloudsql.editor", READS_AND_WRITES],
  ["roles/cloudsql.admin", ADMINISTERS],
  ...BASIC_ROLES,
]);

const DATASET_ROLES: ReadonlyMap<string, GcpDataRole> = new Map<
  string,
  GcpDataRole
>([
  ["roles/bigquery.dataViewer", READS],
  ["roles/bigquery.filteredDataViewer", READS],
  ["roles/bigquery.dataEditor", READS_AND_WRITES],
  ["roles/bigquery.dataOwner", ADMINISTERS],
  ["roles/bigquery.admin", ADMINISTERS],
  // A dataset's own access list names these.
  ["READER", READS],
  ["WRITER", READS_AND_WRITES],
  ["OWNER", ADMINISTERS],
  ...BASIC_ROLES,
]);

// A bucket's ACLs, read only while it is not uniform: the public entries of each.
const BUCKET_ACL_SOURCES: ReadonlyArray<{ field: string; label: string }> = [
  { field: "acl", label: "Bucket ACL" },
  { field: "defaultObjectAcl", label: "Default object ACL" },
];

// One kind of call, for its warning: what it reads, the role it needs, the API it is.
interface GcpReadApi {
  key: string;
  what: string;
  role: string;
  service: string;
  serviceTitle: string;
}

const PROJECTS_API: GcpReadApi = {
  key: "projects",
  what: "projects",
  role: "Browser (roles/browser)",
  service: "cloudresourcemanager.googleapis.com",
  serviceTitle: "Cloud Resource Manager",
};
const RESOURCES_API: GcpReadApi = {
  key: "resources",
  what: "data stores",
  role: "Cloud Asset Viewer (roles/cloudasset.viewer)",
  service: CLOUD_ASSET_SERVICE,
  serviceTitle: "Cloud Asset",
};
const POLICIES_API: GcpReadApi = {
  key: "iam-policies",
  what: "IAM policies",
  role: "Cloud Asset Viewer (roles/cloudasset.viewer)",
  service: CLOUD_ASSET_SERVICE,
  serviceTitle: "Cloud Asset",
};

export interface GcpDataSecurityReadOptions {
  // The OneUptime project the connection belongs to.
  projectId: string;
  connectionId: string;
  /*
   * Every Google Cloud project the OneUptime project has connected: a
   * member of any other project shares the store with it.
   */
  connectedProjectIds: Array<string>;
  transport?: CloudConnectorTransport | undefined;
  // The clock, or the time itself; the system clock when absent.
  now?: (() => Date) | Date | undefined;
  budget?: CloudReadBudget | undefined;
}

interface GcpBinding {
  role: string;
  members: Array<string>;
  conditional: boolean;
}

interface GcpPolicies {
  // Each store's own bindings, by its full resource name.
  byAsset: Map<string, Array<GcpBinding>>;
  // The project's bindings, which every store in it inherits.
  project: Array<GcpBinding>;
  // False when the listing stopped before its last page.
  complete: boolean;
}

interface GcpMember {
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  isPublic: boolean;
  // The project the member belongs to, when its name says.
  project?: string | undefined;
}

// What a store's grants add up to.
interface GcpAccessTally {
  entries: Array<DataStoreAccessEntry>;
  external: Array<string>;
  publicReads: Array<string>;
  publicWrites: Array<string>;
}

type Attempted<T> =
  | { ok: true; value: T }
  | { ok: false; budgetSpent: boolean };

function text(value: unknown): string {
  return readText(value);
}

function lower(value: string): string {
  return value.toLowerCase();
}

function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

// int64 fields come as strings in Google's JSON: "604800".
function numberOrNull(value: unknown): number | null {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

function tail(value: string): string {
  const slash: number = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveNow(now: (() => Date) | Date | undefined): Date {
  if (typeof now === "function") {
    return now();
  }

  return now instanceof Date ? now : new Date();
}

function isAllAddressesCidr(value: string): boolean {
  const trimmed: string = value.trim();
  return trimmed === "0.0.0.0/0" || trimmed === "::/0";
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Authentication
  );
}

function describePlaces(places: Array<string>): string {
  const named: string = places.slice(0, MAX_WARNING_PLACES).join(", ");
  const more: number = places.length - MAX_WARNING_PLACES;

  return more > 0 ? `${named} and ${more} more` : named;
}

type GcpIssueKind = "refused" | "disabled" | "failed";

/*
 * What could not be read, one entry per listing: the projects it failed
 * for and why, so a missing role is one warning however many projects it
 * cost. A 403 that says the API is off (GcpInventoryClient.classify) is a
 * warning with the command that turns it on.
 */
class GcpReadIssues {
  private byApi: Map<
    string,
    {
      api: GcpReadApi;
      places: Array<string>;
      kind: GcpIssueKind;
      reason: string;
    }
  > = new Map();

  public budgetSpent: boolean = false;

  public record(api: GcpReadApi, place: string, error: unknown): void {
    const existing:
      | {
          api: GcpReadApi;
          places: Array<string>;
          kind: GcpIssueKind;
          reason: string;
        }
      | undefined = this.byApi.get(api.key);

    if (existing) {
      if (!existing.places.includes(place)) {
        existing.places.push(place);
      }

      return;
    }

    let kind: GcpIssueKind = "failed";

    if (error instanceof LlmProviderError) {
      if (
        error.kind === CloudConnectionFailureKind.Settings &&
        error.statusCode === 403
      ) {
        kind = "disabled";
      } else if (error.kind === CloudConnectionFailureKind.Permission) {
        kind = "refused";
      }
    }

    this.byApi.set(api.key, {
      api,
      places: [place],
      kind,
      reason: errorText(error),
    });
  }

  public getWarnings(): Array<string> {
    return Array.from(this.byApi.values()).map(
      (entry: {
        api: GcpReadApi;
        places: Array<string>;
        kind: GcpIssueKind;
        reason: string;
      }): string => {
        const places: string = describePlaces(entry.places);

        if (entry.kind === "refused") {
          return `The service account may not read the ${entry.api.what} of ${places}: give it the ${entry.api.role} role.`;
        }

        if (entry.kind === "disabled") {
          return `The ${entry.api.serviceTitle} API is turned off in ${places}, so the ${entry.api.what} there were not read. Turn it on: gcloud services enable ${entry.api.service} --project ${entry.places[0]}${
            entry.places.length > 1
              ? " (and the same for each of the others)"
              : ""
          }`;
        }

        return `Could not read the ${entry.api.what} of ${places}: ${entry.reason}`;
      },
    );
  }
}

async function attempt<T>(data: {
  issues: GcpReadIssues;
  api: GcpReadApi;
  place: string;
  call: () => Promise<T>;
}): Promise<Attempted<T>> {
  try {
    const value: T = await data.call();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof CloudReadBudgetSpent) {
      data.issues.budgetSpent = true;
      return { ok: false, budgetSpent: true };
    }

    if (isAuthenticationFailure(error)) {
      throw error;
    }

    data.issues.record(data.api, data.place, error);
    return { ok: false, budgetSpent: false };
  }
}

/*
 * Google API reads as the connection's service account, with a token of
 * one scope: each request a request of the budget, a burst's 429 asked
 * again (CloudRetry), and every failure classified as the inventory
 * classifies it - an API that is off is a setting, any other 403 a role.
 */
class GoogleApiReader {
  private token: GoogleServiceAccountToken;
  private transport: CloudConnectorTransport;
  private budget: CloudReadBudget | undefined;
  private providerTitle: string;

  public constructor(data: {
    settings: CloudConnectionSettings;
    scope: string;
    providerTitle: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  }) {
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
    this.budget = data.budget;
    this.providerTitle = data.providerTitle;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: readCloudSetting(
        data.settings.secrets,
        "serviceAccountJson",
      ),
      scope: data.scope,
      transport: this.transport,
      providerTitle: data.providerTitle,
    });
  }

  public async getJson(
    url: string,
    step: string,
    service: string,
  ): Promise<JSONObject> {
    return await withCloudRetries({
      call: async (): Promise<JSONObject> => {
        const accessToken: string = await this.signIn();

        try {
          return await LlmProviderHttp.requestJson({
            transport: this.transport,
            method: "GET",
            url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
            step,
            providerTitle: this.providerTitle,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpInventoryClient.classify(error, service);
        }
      },
    });
  }

  /*
   * A GET for a file's own bytes - an object's first bytes, a gzip or a
   * zip as it came. A transport that keeps no bytes gives its text's UTF-8.
   */
  public async getBytes(data: {
    url: string;
    step: string;
    service: string;
    headers: Dictionary<string>;
  }): Promise<Buffer> {
    return await withCloudRetries({
      call: async (): Promise<Buffer> => {
        const accessToken: string = await this.signIn();

        try {
          const response: DataSourceHttpResponse = await LlmProviderHttp.send({
            transport: this.transport,
            method: "GET",
            url: data.url,
            headers: {
              ...data.headers,
              Authorization: `Bearer ${accessToken}`,
            },
            keepBodyBytes: true,
            step: data.step,
            providerTitle: this.providerTitle,
            secretValues: [accessToken],
          });

          return (
            response.bodyBytes || Buffer.from(response.bodyText || "", "utf8")
          );
        } catch (error) {
          throw GcpInventoryClient.classify(error, data.service);
        }
      },
    });
  }

  private async signIn(): Promise<string> {
    if (this.budget && !this.budget.take()) {
      throw new CloudReadBudgetSpent();
    }

    return await this.token.getAccessToken();
  }
}

// Every asset of the types in one project, of one content type, page by page.
async function listAssets(data: {
  reader: GoogleApiReader;
  projectId: string;
  contentType: "RESOURCE" | "IAM_POLICY";
  assetTypes: ReadonlyArray<string>;
}): Promise<{ assets: Array<JSONObject>; complete: boolean }> {
  GoogleMonitoringClient.validateProjectId(data.projectId);

  const assets: Array<JSONObject> = [];
  let pageToken: string = "";

  for (let page: number = 0; page < ASSET_MAX_PAGES; page++) {
    const response: JSONObject = await data.reader.getJson(
      `${ASSET_BASE_URL}/projects/${encodeURIComponent(
        data.projectId,
      )}/assets?${buildQueryString([
        ["contentType", data.contentType],
        ...data.assetTypes.map((type: string): [string, string] => {
          return ["assetTypes", type];
        }),
        ["pageSize", ASSET_PAGE_SIZE],
        ["pageToken", pageToken],
      ])}`,
      data.contentType === "RESOURCE"
        ? "assets request"
        : "IAM policies request",
      CLOUD_ASSET_SERVICE,
    );

    for (const raw of readArray(response["assets"])) {
      assets.push(readObject(raw));
    }

    const next: string = text(response["nextPageToken"]);

    if (!next || next === pageToken) {
      return { assets, complete: true };
    }

    pageToken = next;
  }

  return { assets, complete: false };
}

function readBindings(policy: JSONObject): Array<GcpBinding> {
  const bindings: Array<GcpBinding> = [];

  for (const raw of readArray(policy["bindings"])) {
    const binding: JSONObject = readObject(raw);
    const role: string = text(binding["role"]);
    const members: Array<string> = readArray(binding["members"])
      .map((member: unknown): string => {
        return text(member);
      })
      .filter((member: string): boolean => {
        return Boolean(member);
      });

    if (role && members.length > 0) {
      bindings.push({
        role,
        members,
        conditional: Object.keys(readObject(binding["condition"])).length > 0,
      });
    }
  }

  return bindings;
}

function indexPolicies(listing: {
  assets: Array<JSONObject>;
  complete: boolean;
}): GcpPolicies {
  const byAsset: Map<string, Array<GcpBinding>> = new Map();
  const project: Array<GcpBinding> = [];

  for (const asset of listing.assets) {
    const bindings: Array<GcpBinding> = readBindings(
      readObject(asset["iamPolicy"]),
    );

    if (text(asset["assetType"]) === PROJECT_TYPE) {
      project.push(...bindings);
    } else {
      byAsset.set(text(asset["name"]), [
        ...(byAsset.get(text(asset["name"])) || []),
        ...bindings,
      ]);
    }
  }

  return { byAsset, project, complete: listing.complete };
}

/*
 * The project a service account belongs to, from its address - or none
 * for one of Google's own service agents, which every project has and
 * which are no other customer's.
 */
function serviceAccountProject(email: string): string | undefined {
  const at: number = email.lastIndexOf("@");

  if (at <= 0) {
    return undefined;
  }

  const local: string = email.slice(0, at);
  const domain: string = lower(email.slice(at + 1));

  if (SERVICE_AGENT_REGEX.test(local)) {
    return undefined;
  }

  if (domain.endsWith(IAM_SERVICE_ACCOUNT_SUFFIX)) {
    const project: string = domain.slice(
      0,
      domain.length - IAM_SERVICE_ACCOUNT_SUFFIX.length,
    );

    return project && !project.startsWith("gcp-sa-") ? project : undefined;
  }

  if (domain === APP_ENGINE_SERVICE_ACCOUNT_DOMAIN) {
    return lower(local);
  }

  return undefined;
}

// An IAM member ("user:a@b.com", "serviceAccount:...", "allUsers") as who it is.
function readMember(member: string): GcpMember | null {
  const value: string = member.trim();

  if (!value || value.startsWith("deleted:")) {
    return null;
  }

  if (value === "allUsers") {
    return {
      principal: value,
      principalName: "Anyone on the internet",
      principalType: DataStorePrincipalType.Public,
      isPublic: true,
    };
  }

  if (value === "allAuthenticatedUsers") {
    return {
      principal: value,
      principalName: "Anyone with a Google account",
      principalType: DataStorePrincipalType.Public,
      isPublic: true,
    };
  }

  const colon: number = value.indexOf(":");
  const prefix: string = colon > 0 ? value.slice(0, colon) : "";
  const rest: string = colon > 0 ? value.slice(colon + 1) : value;

  switch (prefix) {
    case "user":
      return {
        principal: value,
        principalName: rest,
        principalType: DataStorePrincipalType.User,
        isPublic: false,
      };
    case "group":
    case "domain":
      return {
        principal: value,
        principalName: rest,
        principalType: DataStorePrincipalType.Group,
        isPublic: false,
      };
    case "serviceAccount":
      return {
        principal: value,
        principalName: rest,
        principalType: DataStorePrincipalType.ServiceAccount,
        isPublic: false,
        project: serviceAccountProject(rest),
      };
    // A bucket's convenience values: everyone with that basic role on the project.
    case "projectOwner":
    case "projectEditor":
    case "projectViewer":
      return {
        principal: value,
        principalName: rest,
        principalType: DataStorePrincipalType.Role,
        isPublic: false,
        project: lower(rest),
      };
    case "principal":
      return {
        principal: value,
        principalType: DataStorePrincipalType.User,
        isPublic: false,
      };
    case "principalSet":
      return {
        principal: value,
        principalType: DataStorePrincipalType.Group,
        isPublic: false,
      };
    default:
      return {
        principal: value,
        principalType: DataStorePrincipalType.Service,
        isPublic: false,
      };
  }
}

function newTally(): GcpAccessTally {
  return { entries: [], external: [], publicReads: [], publicWrites: [] };
}

/*
 * One member's grant. A public member's grant counts only where public
 * access is allowed: a bucket that enforces public access prevention
 * ignores it.
 */
function addGrant(
  tally: GcpAccessTally,
  data: {
    member: GcpMember;
    role: GcpDataRole;
    roleName: string;
    grantedVia: string;
    ours: Set<string>;
    publicAllowed: boolean;
  },
): void {
  const member: GcpMember = data.member;

  if (member.isPublic) {
    if (!data.publicAllowed) {
      return;
    }

    if (data.role.reads) {
      tally.publicReads.push(`${member.principal} has ${data.roleName}`);
    }

    if (data.role.writes) {
      tally.publicWrites.push(`${member.principal} has ${data.roleName}`);
    }
  }

  const external: boolean =
    !member.isPublic &&
    member.project !== undefined &&
    !data.ours.has(lower(member.project));

  if (external && member.project) {
    tally.external.push(member.project);
  }

  tally.entries.push({
    principal: member.principal,
    principalName: member.principalName,
    principalType: member.principalType,
    accessLevel: data.role.level,
    grantedVia: data.grantedVia,
    isExternal: member.isPublic || external,
    isPublic: member.isPublic,
  });
}

function addBindings(
  tally: GcpAccessTally,
  data: {
    bindings: Array<GcpBinding>;
    roles: ReadonlyMap<string, GcpDataRole>;
    // "IAM" for the store's own policy, "Project IAM" for what it inherits.
    via: string;
    ours: Set<string>;
    publicAllowed: boolean;
  },
): void {
  for (const binding of data.bindings) {
    const role: GcpDataRole | undefined = data.roles.get(binding.role);

    if (!role) {
      continue;
    }

    for (const raw of binding.members) {
      const member: GcpMember | null = readMember(raw);

      if (member) {
        addGrant(tally, {
          member,
          role,
          roleName: binding.role,
          grantedVia: `${data.via}: ${binding.role}${
            binding.conditional ? " (conditional)" : ""
          }`,
          ours: data.ours,
          publicAllowed: data.publicAllowed,
        });
      }
    }
  }
}

/*
 * A dataset access list's entry as a member: a user, group or domain, one
 * of the project's basic roles, an IAM member - or an authorized view,
 * routine or dataset, which reads the dataset for whoever may read it.
 */
function datasetAccessMember(
  entry: JSONObject,
  projectId: string,
): GcpMember | null {
  const user: string = text(entry["userByEmail"]);

  if (user) {
    return readMember(
      lower(user).endsWith("gserviceaccount.com")
        ? `serviceAccount:${user}`
        : `user:${user}`,
    );
  }

  const group: string = text(entry["groupByEmail"]);

  if (group) {
    return readMember(`group:${group}`);
  }

  const domain: string = text(entry["domain"]);

  if (domain) {
    return readMember(`domain:${domain}`);
  }

  switch (text(entry["specialGroup"])) {
    case "allAuthenticatedUsers":
      return readMember("allAuthenticatedUsers");
    case "projectOwners":
      return readMember(`projectOwner:${projectId}`);
    case "projectWriters":
      return readMember(`projectEditor:${projectId}`);
    case "projectReaders":
      return readMember(`projectViewer:${projectId}`);
    default:
      break;
  }

  const iamMember: string = text(entry["iamMember"]);

  if (iamMember) {
    return readMember(iamMember);
  }

  const view: JSONObject = readObject(entry["view"]);
  const routine: JSONObject = readObject(entry["routine"]);
  const dataset: JSONObject = readObject(
    readObject(entry["dataset"])["dataset"],
  );
  const reference: { kind: string; ref: JSONObject; name: string } | null =
    text(view["projectId"])
      ? { kind: "view", ref: view, name: text(view["tableId"]) }
      : text(routine["projectId"])
        ? { kind: "routine", ref: routine, name: text(routine["routineId"]) }
        : text(dataset["projectId"])
          ? { kind: "dataset", ref: dataset, name: "" }
          : null;

  if (!reference) {
    return null;
  }

  const referenceProject: string = text(reference.ref["projectId"]);

  return {
    principal: `${reference.kind}:${[
      referenceProject,
      text(reference.ref["datasetId"]),
      reference.name,
    ]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(".")}`,
    principalType: DataStorePrincipalType.Service,
    isPublic: false,
    project: lower(referenceProject),
  };
}

function keepEntries(
  entries: Array<DataStoreAccessEntry>,
  key: (entry: DataStoreAccessEntry) => string,
): Array<DataStoreAccessEntry> {
  const seen: Set<string> = new Set();
  const kept: Array<DataStoreAccessEntry> = [];

  for (const entry of entries) {
    const entryKey: string = key(entry);

    if (seen.has(entryKey)) {
      continue;
    }

    seen.add(entryKey);
    kept.push(entry);

    if (kept.length >= MAX_ACCESS_ENTRIES) {
      break;
    }
  }

  return kept;
}

function publicReason(tally: GcpAccessTally): string | undefined {
  const reasons: Array<string> = unique([
    ...tally.publicReads,
    ...tally.publicWrites,
  ]);

  return reasons.length > 0 ? `${reasons.join("; ")}.` : undefined;
}

/*
 * Whether public grants make a store public: true when one does, false
 * when none does and every grant was read, null when grants went unread.
 */
function publicFact(grants: Array<string>, read: boolean): boolean | null {
  if (grants.length > 0) {
    return true;
  }

  return read ? false : null;
}

function newStore(data: {
  kind: DataStoreKind;
  name: string;
  asset: JSONObject;
  projectId: string;
  region: string;
  labels: unknown;
  posture: DataStorePostureFacts;
  access: Array<DataStoreAccessEntry>;
}): CloudDataStoreRead {
  const tags: Record<string, string> = normalizeCloudTags(data.labels);

  return {
    identity: {
      kind: data.kind,
      name: data.name,
      providerResourceId: text(data.asset["name"]),
      accountNumber: data.projectId,
      region: data.region || undefined,
    },
    posture: data.posture,
    access: data.access,
    tags: Object.keys(tags).length > 0 ? tags : undefined,
  };
}

// Where a bucket's data lives besides its location: a dual-region's two, a multi-region's own.
function bucketReplicationRegions(data: JSONObject): Array<string> {
  const placed: Array<string> = readArray(
    readObject(data["customPlacementConfig"])["dataLocations"],
  )
    .map((location: unknown): string => {
      return lower(text(location));
    })
    .filter((location: string): boolean => {
      return Boolean(location);
    });

  if (placed.length > 0) {
    return placed;
  }

  const location: string = lower(text(data["location"]));
  const type: string = lower(text(data["locationType"]));
  const dualRegion: Array<string> | undefined = GCS_DUAL_REGIONS.get(location);

  if (dualRegion) {
    return [...dualRegion];
  }

  return location && (type === "multi-region" || type === "dual-region")
    ? [location]
    : [];
}

// The public entries of a fine-grained bucket's ACLs.
function addBucketAcls(
  tally: GcpAccessTally,
  data: { bucket: JSONObject; ours: Set<string> },
): void {
  for (const source of BUCKET_ACL_SOURCES) {
    for (const raw of readArray(data.bucket[source.field])) {
      const entry: JSONObject = readObject(raw);
      const entity: string = text(entry["entity"]);
      const roleName: string = text(entry["role"]).toUpperCase();
      const role: GcpDataRole | undefined = DATASET_ROLES.get(roleName);

      if (
        (entity !== "allUsers" && entity !== "allAuthenticatedUsers") ||
        !role
      ) {
        continue;
      }

      addGrant(tally, {
        member: readMember(entity)!,
        role,
        roleName: `${roleName} in its ${lower(source.label)}`,
        grantedVia: `${source.label}: ${roleName}`,
        ours: data.ours,
        publicAllowed: true,
      });
    }
  }
}

function bucketStore(data: {
  asset: JSONObject;
  projectId: string;
  readAt: string;
  policies: GcpPolicies | null;
  ours: Set<string>;
}): CloudDataStoreRead {
  const resource: JSONObject = readObject(data.asset["resource"]);
  const bucket: JSONObject = readObject(resource["data"]);
  const iamConfiguration: JSONObject = readObject(bucket["iamConfiguration"]);
  const preventsPublic: boolean =
    lower(text(iamConfiguration["publicAccessPrevention"])) === "enforced";
  const uniform: boolean =
    flag(
      readObject(iamConfiguration["uniformBucketLevelAccess"])["enabled"],
    ) === true ||
    flag(readObject(iamConfiguration["bucketPolicyOnly"])["enabled"]) === true;
  const own: Array<GcpBinding> | null = data.policies
    ? data.policies.byAsset.get(text(data.asset["name"])) ||
      (data.policies.complete ? [] : null)
    : null;
  const tally: GcpAccessTally = newTally();

  if (own) {
    addBindings(tally, {
      bindings: own,
      roles: BUCKET_ROLES,
      via: "IAM",
      ours: data.ours,
      publicAllowed: !preventsPublic,
    });
  }

  if (data.policies) {
    addBindings(tally, {
      bindings: data.policies.project,
      roles: BUCKET_ROLES,
      via: "Project IAM",
      ours: data.ours,
      publicAllowed: !preventsPublic,
    });
  }

  // Fine-grained buckets also answer to their ACLs; uniform ones ignore them.
  if (!uniform && !preventsPublic) {
    addBucketAcls(tally, { bucket, ours: data.ours });
  }

  const posture: DataStorePostureFacts = {
    readAt: data.readAt,
    publicRead: preventsPublic
      ? false
      : publicFact(tally.publicReads, own !== null),
    publicWrite: preventsPublic
      ? false
      : publicFact(tally.publicWrites, own !== null),
    publicReason: publicReason(tally),
    blockPublicAccess: preventsPublic,
    uniformAccess: uniform,
    customerManagedKey: Boolean(
      text(readObject(bucket["encryption"])["defaultKmsKeyName"]),
    ),
    versioning: flag(readObject(bucket["versioning"])["enabled"]) === true,
    softDelete:
      (numberOrNull(
        readObject(bucket["softDeletePolicy"])["retentionDurationSeconds"],
      ) || 0) > 0,
    accessLogging: Boolean(text(readObject(bucket["logging"])["logBucket"])),
    replicationRegions: bucketReplicationRegions(bucket),
    sharedWithExternal: own !== null ? unique(tally.external) : undefined,
  };

  if (own === null) {
    posture.readWarnings = [
      "Could not read who has access to it: its IAM policy was not read.",
    ];
  }

  return newStore({
    kind: DataStoreKind.GcpStorageBucket,
    name: text(bucket["name"]) || tail(text(data.asset["name"])),
    asset: data.asset,
    projectId: data.projectId,
    region: lower(text(bucket["location"]) || text(resource["location"])),
    labels: bucket["labels"],
    posture,
    access: keepEntries(tally.entries, getDataStoreAccessKey),
  });
}

// Automated backups are daily: so many backups kept is so many days.
function sqlBackupRetentionDays(backup: JSONObject): number | null {
  const settings: JSONObject = readObject(backup["backupRetentionSettings"]);
  const unit: string = text(settings["retentionUnit"]).toUpperCase() || "COUNT";
  const retained: number | null = numberOrNull(settings["retainedBackups"]);

  return unit === "COUNT" ? retained : null;
}

function sqlInstanceStore(data: {
  asset: JSONObject;
  projectId: string;
  readAt: string;
  policies: GcpPolicies | null;
  ours: Set<string>;
  // Each instance of the project's region, by its name: where its replicas are.
  regions: Map<string, string>;
}): CloudDataStoreRead {
  const resource: JSONObject = readObject(data.asset["resource"]);
  const instance: JSONObject = readObject(resource["data"]);
  const settings: JSONObject = readObject(instance["settings"]);
  const ip: JSONObject = readObject(settings["ipConfiguration"]);
  const backup: JSONObject = readObject(settings["backupConfiguration"]);
  const publicIp: boolean = flag(ip["ipv4Enabled"]) === true;
  const sslMode: string = text(ip["sslMode"]).toUpperCase();
  const backups: boolean = flag(backup["enabled"]) === true;
  const region: string = lower(
    text(instance["region"]) || text(resource["location"]),
  );
  const retention: number | null = sqlBackupRetentionDays(backup);
  const tally: GcpAccessTally = newTally();

  if (data.policies) {
    addBindings(tally, {
      bindings: data.policies.project,
      roles: SQL_ROLES,
      via: "Project IAM",
      ours: data.ours,
      publicAllowed: true,
    });
  }

  const replicaRegions: Array<string> = readArray(instance["replicaNames"])
    .map((replica: unknown): string => {
      // A replica in this project is named alone; one elsewhere as "project:instance".
      const name: string = text(replica);
      const colon: number = name.indexOf(":");

      return colon >= 0 && name.slice(0, colon) !== data.projectId
        ? ""
        : data.regions.get(lower(name.slice(colon + 1))) || "";
    })
    .filter((replicaRegion: string): boolean => {
      return Boolean(replicaRegion) && replicaRegion !== region;
    });

  const posture: DataStorePostureFacts = {
    readAt: data.readAt,
    publicNetworkAccess: publicIp,
    openToAllAddresses:
      publicIp &&
      readArray(ip["authorizedNetworks"]).some((network: unknown): boolean => {
        return isAllAddressesCidr(text(readObject(network)["value"]));
      }),
    // sslMode replaced requireSsl; an instance that sets neither takes plain connections.
    encryptionInTransitEnforced: sslMode
      ? sslMode === "ENCRYPTED_ONLY" ||
        sslMode === "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
      : flag(ip["requireSsl"]) === true,
    backupsEnabled: backups,
    // Point-in-time recovery is PostgreSQL's and SQL Server's flag, MySQL's binary log.
    pointInTimeRecovery:
      backups &&
      (flag(backup["pointInTimeRecoveryEnabled"]) === true ||
        flag(backup["binaryLogEnabled"]) === true),
    deletionProtection: flag(settings["deletionProtectionEnabled"]) === true,
    customerManagedKey: Boolean(
      text(readObject(instance["diskEncryptionConfiguration"])["kmsKeyName"]),
    ),
    replicationRegions: unique(replicaRegions),
    sharedWithExternal: data.policies ? unique(tally.external) : undefined,
  };

  if (backups && retention !== null) {
    posture.backupRetentionDays = retention;
  }

  if (!data.policies) {
    posture.readWarnings = [
      "Could not read who has access to it: the project's IAM policy was not read.",
    ];
  }

  return newStore({
    kind: DataStoreKind.GcpCloudSqlInstance,
    name: text(instance["name"]) || tail(text(data.asset["name"])),
    asset: data.asset,
    projectId: data.projectId,
    region,
    labels: settings["userLabels"],
    posture,
    access: keepEntries(tally.entries, getDataStoreAccessKey),
  });
}

function datasetStore(data: {
  asset: JSONObject;
  projectId: string;
  readAt: string;
  policies: GcpPolicies | null;
  ours: Set<string>;
}): CloudDataStoreRead {
  const resource: JSONObject = readObject(data.asset["resource"]);
  const dataset: JSONObject = readObject(resource["data"]);
  const reference: JSONObject = readObject(dataset["datasetReference"]);
  const datasetProject: string = text(reference["projectId"]) || data.projectId;
  const location: string = lower(
    text(dataset["location"]) || text(resource["location"]),
  );
  const accessList: Array<unknown> | null = Array.isArray(dataset["access"])
    ? (dataset["access"] as Array<unknown>)
    : null;
  const own: Array<GcpBinding> | null = data.policies
    ? data.policies.byAsset.get(text(data.asset["name"])) ||
      (data.policies.complete ? [] : null)
    : null;
  const tally: GcpAccessTally = newTally();

  for (const raw of accessList || []) {
    const entry: JSONObject = readObject(raw);
    // An authorized view, routine or dataset names no role: it reads.
    const roleName: string = text(entry["role"]) || "READER";
    const role: GcpDataRole | undefined =
      DATASET_ROLES.get(roleName) || DATASET_ROLES.get(roleName.toUpperCase());
    const member: GcpMember | null = datasetAccessMember(entry, datasetProject);

    if (role && member) {
      addGrant(tally, {
        member,
        role,
        roleName,
        grantedVia: `Dataset access: ${roleName}`,
        ours: data.ours,
        publicAllowed: true,
      });
    }
  }

  if (own) {
    addBindings(tally, {
      bindings: own,
      roles: DATASET_ROLES,
      via: "IAM",
      ours: data.ours,
      publicAllowed: true,
    });
  }

  if (data.policies) {
    addBindings(tally, {
      bindings: data.policies.project,
      roles: DATASET_ROLES,
      via: "Project IAM",
      ours: data.ours,
      publicAllowed: true,
    });
  }

  const known: boolean = accessList !== null || own !== null;
  const posture: DataStorePostureFacts = {
    readAt: data.readAt,
    publicRead: publicFact(tally.publicReads, known),
    publicWrite: publicFact(tally.publicWrites, known),
    publicReason: publicReason(tally),
    customerManagedKey: Boolean(
      text(readObject(dataset["defaultEncryptionConfiguration"])["kmsKeyName"]),
    ),
    replicationRegions: BIGQUERY_MULTI_REGIONS.has(location) ? [location] : [],
    sharedWithExternal: known ? unique(tally.external) : undefined,
  };

  if (!known) {
    posture.readWarnings = [
      "Could not read who has access to it: neither its access list nor its IAM policy was read.",
    ];
  }

  return newStore({
    kind: DataStoreKind.GcpBigQueryDataset,
    name: text(reference["datasetId"]) || tail(text(data.asset["name"])),
    asset: data.asset,
    projectId: data.projectId,
    region: location,
    labels: dataset["labels"],
    posture,
    // A dataset's access list and its IAM policy say the same grants twice.
    access: keepEntries(
      tally.entries,
      (entry: DataStoreAccessEntry): string => {
        return `${entry.principal}|${entry.accessLevel}`;
      },
    ),
  });
}

function buildProjectStores(data: {
  assets: Array<JSONObject>;
  projectId: string;
  readAt: string;
  policies: GcpPolicies | null;
  ours: Set<string>;
}): Array<CloudDataStoreRead> {
  const regions: Map<string, string> = new Map();

  for (const asset of data.assets) {
    if (text(asset["assetType"]) === SQL_INSTANCE_TYPE) {
      const resource: JSONObject = readObject(asset["resource"]);
      const instance: JSONObject = readObject(resource["data"]);

      regions.set(
        lower(text(instance["name"]) || tail(text(asset["name"]))),
        lower(text(instance["region"]) || text(resource["location"])),
      );
    }
  }

  const stores: Array<CloudDataStoreRead> = [];

  for (const asset of data.assets) {
    switch (text(asset["assetType"])) {
      case BUCKET_TYPE:
        stores.push(bucketStore({ ...data, asset }));
        break;
      case SQL_INSTANCE_TYPE:
        stores.push(sqlInstanceStore({ ...data, asset, regions }));
        break;
      case DATASET_TYPE:
        stores.push(datasetStore({ ...data, asset }));
        break;
      default:
        break;
    }
  }

  return stores;
}

/*
 * The connection's data stores: their posture facts, who can reach them
 * and their labels. Throws only when the key is refused (or the settings
 * are not valid); everything else Google Cloud refuses is a warning.
 */
export async function readGcpDataSecurity(
  settings: CloudConnectionSettings,
  options: GcpDataSecurityReadOptions,
): Promise<CloudDataSecurityReadResult> {
  const connector: GcpCloudConnector = new GcpCloudConnector();
  connector.validateSettings(settings);

  const now: Date = resolveNow(options.now);
  const readAt: string = now.toISOString();
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const issues: GcpReadIssues = new GcpReadIssues();
  const warnings: Array<string> = [];
  let complete: boolean = true;

  // 1. The projects: the ones named (or the key's own), or an organization's.
  const state: CloudConnectionPullState = {};
  const resolved: Attempted<Array<string>> = await attempt({
    issues,
    api: PROJECTS_API,
    place: "the organization",
    call: async (): Promise<Array<string>> => {
      return await connector.resolveProjects({
        settings,
        options: { transport },
        budget:
          options.budget ||
          new CloudReadBudget({
            maxRequests: PROJECT_SEARCH_MAX_REQUESTS,
            maxDurationMs: PROJECT_SEARCH_MAX_DURATION_MS,
          }),
        state,
        now,
      });
    },
  });
  const projectIds: Array<string> = resolved.ok
    ? resolved.value
    : connector.getProjects(settings);

  if (!resolved.ok) {
    complete = false;
  }

  const tooMany: string | null = connector.isOrganization(settings)
    ? getOrganizationLimitWarning({
        total: state.organizationAccountCount || 0,
        noun: "projects",
      })
    : null;

  if (tooMany) {
    warnings.push(tooMany);
    complete = false;
  }

  const ours: Set<string> = new Set(
    [...options.connectedProjectIds, ...projectIds].map(
      (projectId: string): string => {
        return lower(projectId.trim());
      },
    ),
  );
  const reader: GoogleApiReader = new GoogleApiReader({
    settings,
    scope: GCP_CLOUD_PLATFORM_READ_SCOPE,
    providerTitle: ASSET_PROVIDER_TITLE,
    transport,
    budget: options.budget,
  });
  const stores: Array<CloudDataStoreRead> = [];
  const busy: Array<string> = [];

  // 2. Each project's stores, then - when it has any - their policies.
  for (const projectId of projectIds) {
    if (issues.budgetSpent) {
      complete = false;
      break;
    }

    const resources: Attempted<{
      assets: Array<JSONObject>;
      complete: boolean;
    }> = await attempt({
      issues,
      api: RESOURCES_API,
      place: projectId,
      call: async (): Promise<{
        assets: Array<JSONObject>;
        complete: boolean;
      }> => {
        return await listAssets({
          reader,
          projectId,
          contentType: "RESOURCE",
          assetTypes: GCP_DATA_STORE_ASSET_TYPES,
        });
      },
    });

    if (!resources.ok) {
      complete = false;
      continue;
    }

    if (!resources.value.complete) {
      complete = false;
      busy.push(projectId);
    }

    if (resources.value.assets.length === 0) {
      continue;
    }

    const policies: Attempted<{
      assets: Array<JSONObject>;
      complete: boolean;
    }> = await attempt({
      issues,
      api: POLICIES_API,
      place: projectId,
      call: async (): Promise<{
        assets: Array<JSONObject>;
        complete: boolean;
      }> => {
        return await listAssets({
          reader,
          projectId,
          contentType: "IAM_POLICY",
          assetTypes: GCP_DATA_STORE_POLICY_ASSET_TYPES,
        });
      },
    });

    stores.push(
      ...buildProjectStores({
        assets: resources.value.assets,
        projectId,
        readAt,
        policies: policies.ok ? indexPolicies(policies.value) : null,
        ours,
      }),
    );
  }

  if (busy.length > 0) {
    warnings.push(
      `${describePlaces(busy)} have more data stores than one read lists: the rest are read next time.`,
    );
  }

  if (issues.budgetSpent) {
    complete = false;
    warnings.push(
      "This read reached its limit: the projects it did not get to are read next time.",
    );
  }

  return {
    stores,
    warnings: [...warnings, ...issues.getWarnings()],
    complete,
  };
}

/*
 * THE CONTENT SCANNER'S READS: a bucket's objects and a dataset's rows,
 * each with a token of its own narrow scope. Hosts are Google's own; a
 * bucket's name and an object's are only ever a path segment, encoded.
 */

// A bucket's name, checked: it is only ever a path segment on Google's host.
export function assertGcsBucketName(bucket: string): string {
  const name: string = (bucket || "").trim();

  if (!BUCKET_NAME_REGEX.test(name)) {
    throw new BadDataException(
      "A bucket's name is 3 to 222 lowercase letters, digits, dots, hyphens and underscores.",
    );
  }

  return name;
}

// At most the size asked for, in case a server sent more than the range.
function firstBytes(bytes: Buffer, maxBytes: number): Uint8Array {
  return new Uint8Array(bytes.subarray(0, Math.max(0, maxBytes)));
}

function clampCount(value: number, min: number, max: number): number {
  const count: number = Math.floor(value);
  return Number.isFinite(count) ? Math.max(min, Math.min(count, max)) : min;
}

function readDate(value: string): Date | undefined {
  const time: number = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : undefined;
}

class GcsObjectStoreReader implements ObjectStoreReader {
  public readonly description: string;
  private reader: GoogleApiReader;
  private bucketUrl: string;

  public constructor(data: { reader: GoogleApiReader; bucket: string }) {
    this.reader = data.reader;
    this.bucketUrl = `${STORAGE_BASE_URL}/b/${encodeURIComponent(data.bucket)}`;
    this.description = `gs://${data.bucket}`;
  }

  // One page of objects.list: names, sizes and when each last changed - none of their metadata.
  public async listObjects(options: {
    prefix?: string | undefined;
    nextToken?: string | undefined;
    maxKeys: number;
  }): Promise<ObjectStoreListPage> {
    const response: JSONObject = await this.reader.getJson(
      `${this.bucketUrl}/o?${buildQueryString([
        ["prefix", options.prefix],
        ["pageToken", options.nextToken],
        ["maxResults", clampCount(options.maxKeys, 1, GCS_LIST_MAX_RESULTS)],
        ["fields", "items(name,size,updated,etag),nextPageToken"],
      ])}`,
      "objects list request",
      STORAGE_SERVICE,
    );
    const objects: Array<ObjectStoreObject> = [];

    for (const raw of readArray(response["items"])) {
      const item: JSONObject = readObject(raw);
      const key: string = typeof item["name"] === "string" ? item["name"] : "";
      const size: number | null = numberOrNull(item["size"]);

      if (!key) {
        continue;
      }

      objects.push({
        key,
        sizeInBytes: size !== null && size > 0 ? size : 0,
        lastModified: readDate(text(item["updated"])),
        etag: text(item["etag"]) || undefined,
      });
    }

    return {
      objects,
      nextToken: text(response["nextPageToken"]) || undefined,
    };
  }

  /*
   * The first bytes of an object (a media download with a Range header),
   * never the whole object - as its bytes, so a gzip or a zip reaches the
   * sampler intact.
   */
  public async readObjectStart(
    key: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    if (
      !key ||
      key === "." ||
      key === ".." ||
      Buffer.byteLength(key, "utf8") > MAX_OBJECT_NAME_BYTES
    ) {
      throw new BadDataException(
        `An object's name is 1 to ${MAX_OBJECT_NAME_BYTES} bytes, and not "." or "..".`,
      );
    }

    const length: number = Math.floor(maxBytes);

    if (!Number.isFinite(length) || length <= 0) {
      return new Uint8Array(0);
    }

    try {
      const body: Buffer = await this.reader.getBytes({
        url: `${this.bucketUrl}/o/${encodeURIComponent(key)}?${buildQueryString(
          [["alt", "media"]],
        )}`,
        step: "object read request",
        service: STORAGE_SERVICE,
        headers: { Range: `bytes=0-${length - 1}` },
      });

      return firstBytes(body, length);
    } catch (error) {
      // An empty object has no first byte: Cloud Storage answers 416.
      if (error instanceof LlmProviderError && error.statusCode === 416) {
        return new Uint8Array(0);
      }

      throw error;
    }
  }
}

// One bucket, for the content scanner: a page of its objects, or the first bytes of one.
export function createGcsObjectStoreReader(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    bucket: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): ObjectStoreReader {
  const bucket: string = assertGcsBucketName(options.bucket);

  return new GcsObjectStoreReader({
    reader: new GoogleApiReader({
      settings,
      scope: GCS_READ_SCOPE,
      providerTitle: STORAGE_PROVIDER_TITLE,
      transport: options.transport,
      budget: options.budget,
    }),
    bucket,
  });
}

interface BigQueryField {
  name: string;
  type: string;
  repeated: boolean;
  fields: Array<BigQueryField>;
}

export interface BigQuerySampleTable {
  table: string;
  // The table's columns, in the schema's order: a RECORD's fields are inside its rows' values.
  columns: Array<string>;
  rows: Array<Record<string, unknown>>;
}

export interface BigQuerySample {
  tables: Array<BigQuerySampleTable>;
  warnings: Array<string>;
}

function readBigQueryFields(raw: unknown, depth: number): Array<BigQueryField> {
  if (depth > BIGQUERY_MAX_DEPTH) {
    return [];
  }

  return readArray(raw)
    .map((item: unknown): BigQueryField => {
      const field: JSONObject = readObject(item);

      return {
        name: text(field["name"]),
        type: text(field["type"]).toUpperCase(),
        repeated: text(field["mode"]).toUpperCase() === "REPEATED",
        fields: readBigQueryFields(field["fields"], depth + 1),
      };
    })
    .filter((field: BigQueryField): boolean => {
      return Boolean(field.name);
    });
}

/*
 * A key set as the object's own property: a column may be named
 * "__proto__", which an assignment would take as the object's prototype.
 */
function setOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function shapeBigQuerySingle(
  value: unknown,
  field: BigQueryField,
  depth: number,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    (field.type === "RECORD" || field.type === "STRUCT") &&
    depth < BIGQUERY_MAX_DEPTH
  ) {
    return shapeBigQueryRow(readObject(value), field.fields, depth + 1);
  }

  return value;
}

/*
 * One cell as its column holds it: a REPEATED column's values as a list
 * (each { v: value }), a RECORD's as an object keyed by its fields, and
 * anything else as BigQuery wrote it - text, or null.
 */
function shapeBigQueryValue(
  value: unknown,
  field: BigQueryField,
  depth: number,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (field.repeated) {
    return readArray(value).map((item: unknown): unknown => {
      return shapeBigQuerySingle(readObject(item)["v"], field, depth);
    });
  }

  return shapeBigQuerySingle(value, field, depth);
}

// A tabledata.list row ({ f: [{ v }] }) as an object keyed by column name.
function shapeBigQueryRow(
  row: JSONObject,
  fields: Array<BigQueryField>,
  depth: number,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};
  const cells: Array<unknown> = readArray(row["f"]);

  fields.forEach((field: BigQueryField, index: number) => {
    setOwn(
      shaped,
      field.name,
      shapeBigQueryValue(readObject(cells[index])["v"], field, depth),
    );
  });

  return shaped;
}

/*
 * A sample of a dataset's tables, for the content scanner: at most
 * maxTables of its tables (views and external tables hold no rows of
 * their own), each with its schema and its first maxRowsPerTable rows.
 * A table that cannot be read is a warning; a refused key is thrown.
 */
export async function readBigQuerySample(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    projectId: string;
    datasetId: string;
    maxTables: number;
    maxRowsPerTable: number;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<BigQuerySample> {
  GoogleMonitoringClient.validateProjectId(options.projectId);

  const datasetId: string = (options.datasetId || "").trim();

  if (!DATASET_ID_REGEX.test(datasetId)) {
    throw new BadDataException(
      "A dataset's id is letters, digits and underscores.",
    );
  }

  const projectId: string = options.projectId.trim();
  const maxTables: number = clampCount(
    options.maxTables,
    0,
    BIGQUERY_MAX_TABLES,
  );
  const maxRows: number = clampCount(
    options.maxRowsPerTable,
    0,
    BIGQUERY_MAX_ROWS_PER_TABLE,
  );
  const sample: BigQuerySample = { tables: [], warnings: [] };
  const where: string = `${projectId}.${datasetId}`;

  if (maxTables === 0) {
    return sample;
  }

  const reader: GoogleApiReader = new GoogleApiReader({
    settings,
    scope: BIGQUERY_READ_SCOPE,
    providerTitle: BIGQUERY_PROVIDER_TITLE,
    transport: options.transport,
    budget: options.budget,
  });
  const tablesUrl: string = `${BIGQUERY_BASE_URL}/projects/${encodeURIComponent(
    projectId,
  )}/datasets/${encodeURIComponent(datasetId)}/tables`;
  const tableIds: Array<string> = [];
  let more: boolean = false;

  // 1. Its tables, page by page, until there are enough.
  try {
    let pageToken: string = "";

    for (let page: number = 0; page < BIGQUERY_TABLE_MAX_PAGES; page++) {
      const response: JSONObject = await reader.getJson(
        `${tablesUrl}?${buildQueryString([
          ["maxResults", BIGQUERY_TABLE_PAGE_SIZE],
          ["pageToken", pageToken],
        ])}`,
        "tables list request",
        BIGQUERY_SERVICE,
      );

      for (const raw of readArray(response["tables"])) {
        const table: JSONObject = readObject(raw);
        const tableId: string = text(
          readObject(table["tableReference"])["tableId"],
        );

        if (!tableId || text(table["type"]).toUpperCase() !== "TABLE") {
          continue;
        }

        if (tableIds.length < maxTables) {
          tableIds.push(tableId);
        } else {
          more = true;
        }
      }

      const next: string = text(response["nextPageToken"]);

      if (!next || next === pageToken) {
        break;
      }

      if (tableIds.length >= maxTables) {
        more = true;
        break;
      }

      pageToken = next;
    }
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw error;
    }

    sample.warnings.push(
      error instanceof CloudReadBudgetSpent
        ? `The tables of ${where} were not listed: the read reached its limit.`
        : `Could not list the tables of ${where}: ${errorText(error)}`,
    );

    return sample;
  }

  // 2. Each table's schema, then its first rows.
  for (const tableId of tableIds) {
    const tableUrl: string = `${tablesUrl}/${encodeURIComponent(tableId)}`;

    try {
      const table: JSONObject = await reader.getJson(
        `${tableUrl}?${buildQueryString([["fields", "schema"]])}`,
        "table request",
        BIGQUERY_SERVICE,
      );
      const fields: Array<BigQueryField> = readBigQueryFields(
        readObject(table["schema"])["fields"],
        0,
      );
      const rows: Array<Record<string, unknown>> = [];
      let pageToken: string = "";

      for (
        let page: number = 0;
        page < BIGQUERY_ROW_MAX_PAGES && rows.length < maxRows;
        page++
      ) {
        const data: JSONObject = await reader.getJson(
          `${tableUrl}/data?${buildQueryString([
            ["maxResults", maxRows - rows.length],
            ["pageToken", pageToken],
          ])}`,
          "table data request",
          BIGQUERY_SERVICE,
        );

        for (const raw of readArray(data["rows"])) {
          if (rows.length >= maxRows) {
            break;
          }

          rows.push(shapeBigQueryRow(readObject(raw), fields, 0));
        }

        const next: string = text(data["pageToken"]);

        if (!next || next === pageToken) {
          break;
        }

        pageToken = next;
      }

      sample.tables.push({
        table: tableId,
        columns: fields.map((field: BigQueryField): string => {
          return field.name;
        }),
        rows,
      });
    } catch (error) {
      if (isAuthenticationFailure(error)) {
        throw error;
      }

      if (error instanceof CloudReadBudgetSpent) {
        sample.warnings.push(
          `The read reached its limit: ${tableIds.length - sample.tables.length} tables of ${where} were not read.`,
        );
        break;
      }

      sample.warnings.push(
        `Could not read table ${tableId} of ${where}: ${errorText(error)}`,
      );
    }
  }

  if (more) {
    sample.warnings.push(
      `${where} has more tables than one sample reads: the first ${tableIds.length} were read.`,
    );
  }

  return sample;
}
