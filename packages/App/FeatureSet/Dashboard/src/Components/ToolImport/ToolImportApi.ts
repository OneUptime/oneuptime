import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  readToolImportReport,
  ToolImportPlan,
  ToolImportReport,
  ToolImportRunView,
  ToolImportSelection,
} from "Common/Types/ToolImport/ToolImportPlan";
import { isToolImportRunStatus } from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource, {
  isToolImportSource,
} from "Common/Types/ToolImport/ToolImportSource";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The page's calls to the import API (Common/Server/API/ToolImportAPI). Every
 * call carries the project's headers, and a non-2xx answer is thrown, so the
 * page shows it with API.getFriendlyMessage. React-free: tested from App.
 *
 * The API key goes out once, in startToolImportRead's body over TLS, and no
 * answer ever carries it back.
 */

export const TOOL_IMPORT_ROUTES: {
  runs: string;
  read: string;
  upload: string;
  run: (runId: string) => string;
  start: (runId: string) => string;
  cancel: (runId: string) => string;
} = {
  runs: "/tool-import/runs",
  read: "/tool-import/read",
  upload: "/tool-import/upload",
  run: (runId: string): string => {
    return `/tool-import/run/${encodeURIComponent(runId)}`;
  },
  start: (runId: string): string => {
    return `/tool-import/run/${encodeURIComponent(runId)}/start`;
  },
  cancel: (runId: string): string => {
    return `/tool-import/run/${encodeURIComponent(runId)}/cancel`;
  },
};

export interface ToolImportRunDetails {
  run: ToolImportRunView;
  // While the run waits for its reader to start it.
  plan?: ToolImportPlan | undefined;
  // Once it ran.
  report?: ToolImportReport | undefined;
}

function apiUrl(route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
}

async function getJson(route: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

async function postJson(route: string, body: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

/*
 * A run as the server described it, checked: a run whose source or status
 * this build does not know is dropped rather than drawn half-known.
 */
export function readToolImportRunView(
  value: JSONValue | undefined,
): ToolImportRunView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const run: JSONObject = value as JSONObject;

  if (
    typeof run["id"] !== "string" ||
    !isToolImportSource(run["source"]) ||
    !isToolImportRunStatus(run["status"])
  ) {
    return null;
  }

  return run as unknown as ToolImportRunView;
}

export async function listToolImportRuns(): Promise<Array<ToolImportRunView>> {
  const body: JSONObject = await getJson(TOOL_IMPORT_ROUTES.runs);
  const runs: Array<JSONValue> = Array.isArray(body["runs"])
    ? (body["runs"] as Array<JSONValue>)
    : [];

  return runs
    .map((run: JSONValue): ToolImportRunView | null => {
      return readToolImportRunView(run);
    })
    .filter((run: ToolImportRunView | null): run is ToolImportRunView => {
      return Boolean(run);
    });
}

/*
 * What the read is sent: the tool, its region and the key - and, for a tool
 * that needs them, the key's ID (Splunk On-Call) or its API's address
 * (Grafana OnCall). A field the tool does not use is not sent.
 */
export async function startToolImportRead(data: {
  source: ToolImportSource;
  region: string;
  apiKey: string;
  apiKeyId?: string | undefined;
  apiUrl?: string | undefined;
}): Promise<string> {
  const request: JSONObject = {
    source: data.source,
    region: data.region,
    apiKey: data.apiKey,
  };

  if (data.apiKeyId !== undefined) {
    request["apiKeyId"] = data.apiKeyId;
  }

  if (data.apiUrl !== undefined) {
    request["apiUrl"] = data.apiUrl;
  }

  const body: JSONObject = await postJson(TOOL_IMPORT_ROUTES.read, request);

  if (typeof body["runId"] !== "string") {
    throw new Error(
      translationKey("The import could not be started. Try again."),
    );
  }

  return body["runId"];
}

/*
 * A tool read from a file (Uptime Kuma): the file's text goes up once, is
 * read on the server at once, and comes back as a run waiting for review.
 * The file is never stored.
 */
export async function uploadToolImportFile(data: {
  source: ToolImportSource;
  fileName: string;
  content: string;
}): Promise<string> {
  const body: JSONObject = await postJson(TOOL_IMPORT_ROUTES.upload, {
    source: data.source,
    fileName: data.fileName,
    content: data.content,
  });

  if (typeof body["runId"] !== "string") {
    throw new Error(
      translationKey("The import could not be started. Try again."),
    );
  }

  return body["runId"];
}

export async function getToolImportRun(
  runId: string,
): Promise<ToolImportRunDetails> {
  const body: JSONObject = await getJson(TOOL_IMPORT_ROUTES.run(runId));
  const run: ToolImportRunView | null = readToolImportRunView(body["run"]);

  if (!run) {
    throw new Error(translationKey("This import was not found."));
  }

  const details: ToolImportRunDetails = { run: run };

  if (body["plan"] && typeof body["plan"] === "object") {
    details.plan = body["plan"] as unknown as ToolImportPlan;
  }

  if (body["report"]) {
    details.report = readToolImportReport(body["report"]);
  }

  return details;
}

export async function startToolImport(
  runId: string,
  selection: ToolImportSelection,
): Promise<void> {
  const body: JSONObject = {
    selectedKeys: selection.selectedKeys,
    inviteTeamId: selection.inviteTeamId,
  };

  // Sent only when given: the server moves no subscriber without it.
  if (selection.subscribersConsent === true) {
    body["subscribersConsent"] = true;
  }

  await postJson(TOOL_IMPORT_ROUTES.start(runId), body);
}

export async function cancelToolImport(runId: string): Promise<void> {
  await postJson(TOOL_IMPORT_ROUTES.cancel(runId), {});
}

const LEADING_DOCS: RegExp = /^\/docs/;

// A docs path from the catalog ("/docs/moving-to-oneuptime/opsgenie") on the docs site.
export function toolImportDocsUrl(docsPath: string): URL {
  return URL.fromString(
    `${DOCS_URL.toString()}${docsPath.replace(LEADING_DOCS, "")}`,
  );
}
