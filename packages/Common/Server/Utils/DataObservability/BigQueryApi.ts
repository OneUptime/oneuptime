import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import GoogleServiceAccountToken from "../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderHttp from "../LlmObservability/LlmProviderHttp";

/*
 * GOOGLE BIGQUERY, OVER ITS REST API, AS A SERVICE ACCOUNT.
 *
 * A dataset is a store: Data Security finds them from a Google Cloud
 * connection, and Data Observability collects each with that connection's
 * own service account (DataObservabilityRunner builds the connection when it
 * collects, and keeps it nowhere). A dataset can be connected by hand too,
 * with JSON: { projectId, dataset, location, serviceAccountJson }. Each
 * statement is a query job, followed to its last page; the service account
 * needs BigQuery Metadata Viewer for the catalog and BigQuery Job User to
 * run it, and Data Viewer on a table a check reads.
 */

export interface BigQueryConnection {
  projectId: string;
  dataset: string;
  location: string | null;
  serviceAccountJson: string;
}

export type BigQueryTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

const BIGQUERY_BASE_URL: string = "https://bigquery.googleapis.com/bigquery/v2";
const BIGQUERY_READ_SCOPE: string =
  "https://www.googleapis.com/auth/bigquery.readonly";
const PROVIDER_TITLE: string = "Google BigQuery";
const QUERY_WAIT_MS: number = 30_000;
const QUERY_MAX_ROWS: number = 10_000;
const MAX_CALLS: number = 30;

const PROJECT_PATTERN: RegExp = /^[a-z][a-z0-9:.-]{4,62}$/i;
const DATASET_PATTERN: RegExp = /^[A-Za-z0-9_]{1,1024}$/;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

export function readBigQueryConnection(value: string): BigQueryConnection {
  let raw: JSONObject = {};

  try {
    raw = readObject(JSON.parse((value || "").trim()));
  } catch {
    raw = {};
  }

  const serviceAccount: unknown = raw["serviceAccountJson"];
  const connection: BigQueryConnection = {
    projectId: readText(raw["projectId"]),
    dataset: readText(raw["dataset"]),
    location: readText(raw["location"]) || null,
    serviceAccountJson:
      typeof serviceAccount === "string"
        ? serviceAccount
        : serviceAccount && typeof serviceAccount === "object"
          ? JSON.stringify(serviceAccount)
          : "",
  };

  if (!PROJECT_PATTERN.test(connection.projectId)) {
    throw new Error("The BigQuery connection needs its projectId.");
  }

  if (!DATASET_PATTERN.test(connection.dataset)) {
    throw new Error("The BigQuery connection needs its dataset.");
  }

  if (!connection.serviceAccountJson.includes("private_key")) {
    throw new Error(
      "The BigQuery connection needs a service account key (serviceAccountJson).",
    );
  }

  return connection;
}

// The connection of a dataset a Google Cloud connection found, for one collection.
export function buildBigQueryConnectionString(
  connection: BigQueryConnection,
): string {
  return JSON.stringify(connection);
}

/*
 * A query's rows, each keyed by its field's name in lower case. A value is
 * its text, as BigQuery's REST API writes every value; a timestamp is
 * seconds since the epoch.
 */
export function readBigQueryRows(
  body: JSONObject,
): Array<Record<string, unknown>> {
  const names: Array<string> = readArray(
    readObject(body["schema"])["fields"],
  ).map((field: unknown): string => {
    return readText(readObject(field)["name"]).toLowerCase();
  });

  return readArray(body["rows"]).map(
    (row: unknown): Record<string, unknown> => {
      const cells: Array<unknown> = readArray(readObject(row)["f"]);
      const record: Record<string, unknown> = {};

      names.forEach((name: string, index: number) => {
        record[name] = readObject(cells[index])["v"] ?? null;
      });

      return record;
    },
  );
}

export default class BigQueryApi {
  private readonly connection: BigQueryConnection;
  private readonly transport: BigQueryTransport;
  private readonly token: GoogleServiceAccountToken;

  public constructor(data: {
    connection: BigQueryConnection;
    transport?: BigQueryTransport | undefined;
  }) {
    this.connection = data.connection;
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: data.connection.serviceAccountJson,
      scope: BIGQUERY_READ_SCOPE,
      transport: this.transport,
      providerTitle: PROVIDER_TITLE,
    });
  }

  private async request(data: {
    method: "GET" | "POST";
    url: string;
    body?: JSONObject | undefined;
    step: string;
  }): Promise<JSONObject> {
    const accessToken: string = await this.token.getAccessToken();

    return await LlmProviderHttp.requestJson({
      transport: this.transport,
      method: data.method,
      url: data.url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(data.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(data.body ? { body: JSON.stringify(data.body) } : {}),
      timeoutInMs: QUERY_WAIT_MS + 15_000,
      step: data.step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [accessToken],
    });
  }

  // One query's rows, its parameters bound by position (?), every page.
  public async query(data: {
    statement: string;
    params?: Array<string> | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    const base: string = `${BIGQUERY_BASE_URL}/projects/${encodeURIComponent(
      this.connection.projectId,
    )}/queries`;
    let answer: JSONObject = await this.request({
      method: "POST",
      url: base,
      step: "query",
      body: {
        query: data.statement,
        useLegacySql: false,
        timeoutMs: QUERY_WAIT_MS,
        maxResults: QUERY_MAX_ROWS,
        ...(this.connection.location
          ? { location: this.connection.location }
          : {}),
        ...((data.params || []).length > 0
          ? {
              parameterMode: "POSITIONAL",
              queryParameters: (data.params || []).map(
                (value: string): JSONObject => {
                  return {
                    parameterType: { type: "STRING" },
                    parameterValue: { value },
                  };
                },
              ),
            }
          : {}),
      },
    });
    const job: JSONObject = readObject(answer["jobReference"]);
    const jobId: string = readText(job["jobId"]);
    const location: string = readText(job["location"]);
    const rows: Array<Record<string, unknown>> = [];
    let schema: JSONObject | undefined = undefined;

    for (let call: number = 0; call < MAX_CALLS; call++) {
      // An answer still running has no schema yet; a later page repeats it.
      const answerSchema: JSONObject = readObject(answer["schema"]);

      if (readArray(answerSchema["fields"]).length > 0) {
        schema = answerSchema;
      }

      if (answer["jobComplete"] !== false) {
        rows.push(...readBigQueryRows({ ...answer, schema }));

        const pageToken: string = readText(answer["pageToken"]);

        if (!pageToken) {
          return rows;
        }

        answer = await this.request({
          method: "GET",
          url: `${base}/${encodeURIComponent(jobId)}?${new URLSearchParams({
            location,
            pageToken,
            maxResults: String(QUERY_MAX_ROWS),
            timeoutMs: String(QUERY_WAIT_MS),
          }).toString()}`,
          step: "query results",
        });
        continue;
      }

      // Still running: asked again, waiting up to QUERY_WAIT_MS.
      answer = await this.request({
        method: "GET",
        url: `${base}/${encodeURIComponent(jobId)}?${new URLSearchParams({
          location,
          maxResults: String(QUERY_MAX_ROWS),
          timeoutMs: String(QUERY_WAIT_MS),
        }).toString()}`,
        step: "query results",
      });
    }

    throw new Error("The BigQuery query did not finish in time.");
  }
}
