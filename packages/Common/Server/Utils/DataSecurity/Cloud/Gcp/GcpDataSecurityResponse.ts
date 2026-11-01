import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  readCloudSetting,
} from "../../../CloudConnection/CloudConnectorTypes";
import { withCloudRetries } from "../../../CloudConnection/CloudRetry";
import GcpCloudConnector from "../../../CloudConnection/Gcp/GcpCloudConnector";
import GcpInventoryClient from "../../../CloudConnection/Gcp/GcpInventory";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import GoogleServiceAccountToken from "../../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readObject,
  readText,
} from "../../../LlmObservability/LlmProviderHttp";
import { assertGcsBucketName } from "./GcpDataSecurityReader";
import { DataSecurityResponseOutcome } from "../DataSecurityCloudTypes";

/*
 * DATA SECURITY'S RESPONSE ACTIONS ON GOOGLE CLOUD: what a person - or, for
 * the first, a playbook - may change on a bucket Data Security found.
 *
 *   blockGcsBucketPublicAccess - a bucket's public access prevention
 *   enforced, after which nothing in it is public: an allUsers or
 *   allAuthenticatedUsers grant in its IAM policy or its ACLs does
 *   nothing, and no new one can be made.
 *
 *     GET   https://storage.googleapis.com/storage/v1/b/{bucket}
 *           ?fields=name,iamConfiguration          -> its setting
 *     PATCH (the same) { iamConfiguration: { publicAccessPrevention: "enforced" } }
 *
 *   turnOnGcsUniformAccess - uniform bucket-level access on: object ACLs
 *   grant nothing, its IAM policy alone decides.
 *
 *     PATCH (the same) { iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } }
 *
 *   turnOnGcsBucketVersioning - Object Versioning on.
 *
 *     GET   ...?fields=name,versioning
 *     PATCH (the same) { versioning: { enabled: true } }
 *
 * Each reads first and writes only what is not already so: run twice, it
 * changes nothing the second time, and says so. A PATCH changes the one
 * setting it names; only the bucket's name and the setting are read and
 * written back, never its ACLs or labels.
 *
 * The token is of devstorage.full_control, the narrowest scope that
 * allows buckets.patch. The service account may make the change only once
 * the connection's opt-in "Data security response" setting is on and its
 * updated setup command has given it storage.buckets.get and
 * storage.buckets.update; until then the change is refused, and the error
 * says so.
 */

const PROVIDER_TITLE: string = "Google Cloud Storage";
const STORAGE_BASE_URL: string = "https://storage.googleapis.com/storage/v1";
const STORAGE_SERVICE: string = "storage.googleapis.com";
export const GCS_BUCKET_ADMIN_SCOPE: string =
  "https://www.googleapis.com/auth/devstorage.full_control";
// What is read of a bucket and written back: never its ACLs or labels.
const BUCKET_FIELDS: string = "name,iamConfiguration";
// What is read of a bucket's versioning, and written back.
const VERSIONING_FIELDS: string = "name,versioning";
const READ_PERMISSION: string = "storage.buckets.get";
const WRITE_PERMISSION: string = "storage.buckets.update";

// What the action did: the outcome every cloud's response gives.
export type DataSecurityResponseResult = DataSecurityResponseOutcome;

/*
 * One request about a bucket: a request of the budget, a burst's 429
 * asked again (the PATCH sets a value, so a second try is the same as
 * the first), and a failure classified as the inventory classifies it.
 */
async function bucketRequest(data: {
  token: GoogleServiceAccountToken;
  transport: CloudConnectorTransport;
  budget?: CloudReadBudget | undefined;
  method: "GET" | "PATCH";
  url: string;
  body?: JSONObject | undefined;
  step: string;
}): Promise<JSONObject> {
  return await withCloudRetries({
    call: async (): Promise<JSONObject> => {
      if (data.budget && !data.budget.take()) {
        throw new CloudReadBudgetSpent();
      }

      const accessToken: string = await data.token.getAccessToken();

      try {
        const response: DataSourceHttpResponse = await LlmProviderHttp.send({
          transport: data.transport,
          method: data.method,
          url: data.url,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            ...(data.body ? { "Content-Type": "application/json" } : {}),
          },
          body: data.body ? JSON.stringify(data.body) : undefined,
          step: data.step,
          providerTitle: PROVIDER_TITLE,
          secretValues: [accessToken],
        });

        return readObject(response.bodyJson);
      } catch (error) {
        throw GcpInventoryClient.classify(error, STORAGE_SERVICE);
      }
    },
  });
}

/*
 * What a refused or failed call means, for the person reading the
 * playbook run: which permission is missing and how the connection gets
 * it, or a bucket that is gone. An API turned off already says the command
 * that turns it on; a refused key stays what it is.
 */
function explainFailure(
  error: unknown,
  data: { bucket: string; writing: boolean },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    return new LlmProviderError({
      message: `The service account may not ${data.writing ? "change" : "read"} bucket ${data.bucket}: it needs ${
        data.writing ? WRITE_PERMISSION : READ_PERMISSION
      }. Turn on the connection's "Data security response" setting and run its updated setup command.`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  if (error.statusCode === 404) {
    return new LlmProviderError({
      message: `Bucket ${data.bucket} was not found: it may have been deleted.`,
      kind: CloudConnectionFailureKind.Settings,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

interface BucketOptions {
  connectionId: string;
  bucket: string;
  transport?: CloudConnectorTransport | undefined;
  budget?: CloudReadBudget | undefined;
}

interface OpenBucket {
  bucket: string;
  // Reads or writes the fields named of the bucket.
  request: (data: {
    method: "GET" | "PATCH";
    fields: string;
    body?: JSONObject | undefined;
    step: string;
  }) => Promise<JSONObject>;
}

// The bucket a response action changes, and a token of the narrowest scope that may.
function openBucket(
  settings: CloudConnectionSettings,
  options: BucketOptions,
): OpenBucket {
  new GcpCloudConnector().validateSettings(settings);

  const bucket: string = assertGcsBucketName(options.bucket);
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const token: GoogleServiceAccountToken = new GoogleServiceAccountToken({
    serviceAccountJson: readCloudSetting(
      settings.secrets,
      "serviceAccountJson",
    ),
    scope: GCS_BUCKET_ADMIN_SCOPE,
    transport,
    providerTitle: PROVIDER_TITLE,
  });

  return {
    bucket,
    request: async (data: {
      method: "GET" | "PATCH";
      fields: string;
      body?: JSONObject | undefined;
      step: string;
    }): Promise<JSONObject> => {
      try {
        return await bucketRequest({
          token,
          transport,
          budget: options.budget,
          method: data.method,
          url: `${STORAGE_BASE_URL}/b/${encodeURIComponent(
            bucket,
          )}?${buildQueryString([["fields", data.fields]])}`,
          body: data.body,
          step: data.step,
        });
      } catch (error) {
        throw explainFailure(error, {
          bucket,
          writing: data.method === "PATCH",
        });
      }
    },
  };
}

/*
 * Enforces a bucket's public access prevention, unless it is enforced
 * already. Throws when the bucket cannot be read or changed, with what to
 * do.
 */
export async function blockGcsBucketPublicAccess(
  settings: CloudConnectionSettings,
  options: BucketOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenBucket = openBucket(settings, options);
  const current: JSONObject = await open.request({
    method: "GET",
    fields: BUCKET_FIELDS,
    step: "bucket request",
  });

  if (
    readText(
      readObject(current["iamConfiguration"])["publicAccessPrevention"],
    ).toLowerCase() === "enforced"
  ) {
    return {
      changed: false,
      summary: `Public access prevention is already on for bucket ${open.bucket}; nothing changed.`,
    };
  }

  await open.request({
    method: "PATCH",
    fields: BUCKET_FIELDS,
    body: { iamConfiguration: { publicAccessPrevention: "enforced" } },
    step: "bucket update",
  });

  return {
    changed: true,
    summary: `Turned on public access prevention for bucket ${open.bucket}: nothing in it can be read publicly now, whatever its IAM policy or ACLs say.`,
  };
}

/*
 * Turns a bucket's Object Versioning on, unless it is on already: an
 * object overwritten or deleted from then on keeps its earlier version.
 */
export async function turnOnGcsBucketVersioning(
  settings: CloudConnectionSettings,
  options: BucketOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenBucket = openBucket(settings, options);
  const current: JSONObject = await open.request({
    method: "GET",
    fields: VERSIONING_FIELDS,
    step: "bucket request",
  });

  if (readObject(current["versioning"])["enabled"] === true) {
    return {
      changed: false,
      summary: `Object Versioning is already on for bucket ${open.bucket}; nothing changed.`,
    };
  }

  await open.request({
    method: "PATCH",
    fields: VERSIONING_FIELDS,
    body: { versioning: { enabled: true } },
    step: "bucket update",
  });

  return {
    changed: true,
    summary: `Turned on Object Versioning for bucket ${open.bucket}: an object overwritten or deleted from now on can be restored from its earlier version.`,
  };
}

/*
 * Turns on a bucket's uniform bucket-level access, unless it is on
 * already: object ACLs grant nothing from then on, and the bucket's IAM
 * policy alone decides who reads it. Google Cloud lets it be turned off
 * again for 90 days only.
 */
export async function turnOnGcsUniformAccess(
  settings: CloudConnectionSettings,
  options: BucketOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenBucket = openBucket(settings, options);
  const current: JSONObject = await open.request({
    method: "GET",
    fields: BUCKET_FIELDS,
    step: "bucket request",
  });

  if (
    readObject(
      readObject(current["iamConfiguration"])["uniformBucketLevelAccess"],
    )["enabled"] === true
  ) {
    return {
      changed: false,
      summary: `Uniform bucket-level access is already on for bucket ${open.bucket}; nothing changed.`,
    };
  }

  await open.request({
    method: "PATCH",
    fields: BUCKET_FIELDS,
    body: { iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } },
    step: "bucket update",
  });

  return {
    changed: true,
    summary: `Turned on uniform bucket-level access for bucket ${open.bucket}: object ACLs grant nothing now, and its IAM policy alone decides who reads it. It can be turned off again for 90 days.`,
  };
}
