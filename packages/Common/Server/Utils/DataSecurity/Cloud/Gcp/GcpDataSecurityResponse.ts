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
 * DATA SECURITY'S RESPONSE ACTIONS ON GOOGLE CLOUD: what a playbook may
 * change to close an exposure Data Security found.
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
 * It reads first and writes only what is not already so: run twice, it
 * changes nothing the second time, and says so. A PATCH changes the one
 * setting it names; only the bucket's name and IAM configuration are read
 * and written back, never its ACLs or labels.
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

/*
 * Enforces a bucket's public access prevention, unless it is enforced
 * already. Throws when the bucket cannot be read or changed, with what to
 * do.
 */
export async function blockGcsBucketPublicAccess(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    bucket: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<DataSecurityResponseResult> {
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
  const url: string = `${STORAGE_BASE_URL}/b/${encodeURIComponent(
    bucket,
  )}?${buildQueryString([["fields", BUCKET_FIELDS]])}`;

  let current: JSONObject;

  try {
    current = await bucketRequest({
      token,
      transport,
      budget: options.budget,
      method: "GET",
      url,
      step: "bucket request",
    });
  } catch (error) {
    throw explainFailure(error, { bucket, writing: false });
  }

  if (
    readText(
      readObject(current["iamConfiguration"])["publicAccessPrevention"],
    ).toLowerCase() === "enforced"
  ) {
    return {
      changed: false,
      summary: `Public access prevention is already on for bucket ${bucket}; nothing changed.`,
    };
  }

  try {
    await bucketRequest({
      token,
      transport,
      budget: options.budget,
      method: "PATCH",
      url,
      body: { iamConfiguration: { publicAccessPrevention: "enforced" } },
      step: "bucket update",
    });
  } catch (error) {
    throw explainFailure(error, { bucket, writing: true });
  }

  return {
    changed: true,
    summary: `Turned on public access prevention for bucket ${bucket}: nothing in it can be read publicly now, whatever its IAM policy or ACLs say.`,
  };
}
