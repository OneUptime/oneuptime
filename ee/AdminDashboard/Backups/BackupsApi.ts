import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { BackupPostgresCounts } from "Common/Types/Backup/BackupManifest";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Backups page's calls to the Enterprise Edition's routes
 * (ee/Server/Backup/API/BackupAPI.ts) - everything beyond reading the
 * settings and the runs, which go through the model API. A refusal comes
 * back as an Error with the server's own sentence.
 */

export interface BackupsOverview {
  isSetUp: boolean;
  isActive: boolean;
  isAvailable: boolean;
  nextBackupAt: string | null;
  location: string | null;
  destinationFingerprint: string | null;
  destinationError: string | null;
  postgres: {
    version?: string | undefined;
    sizeInBytes?: number | undefined;
    database?: string | undefined;
    canRestore?: boolean | undefined;
    user?: string | undefined;
    error?: string | undefined;
  } | null;
  clickhouse: {
    version?: string | undefined;
    sizeInBytes?: number | undefined;
    database?: string | undefined;
    error?: string | undefined;
  } | null;
}

export interface BackupTestCheck {
  key: "storage" | "postgres" | "clickhouse";
  isSuccessful: boolean;
  message: string;
}

export interface BackupTestResult {
  isSuccessful: boolean;
  checks: Array<BackupTestCheck>;
}

export interface RestoreIssue {
  code: string;
  message: string;
}

export interface RestorePreview {
  backup: {
    id: string;
    name: string;
    startedAt: string;
    oneuptimeVersion: string;
    postgres: {
      sizeInBytes: number;
      serverVersion: string;
      counts: BackupPostgresCounts;
    } | null;
    clickhouse: { sizeInBytes: number; serverVersion: string } | null;
  };
  current: {
    oneuptimeVersion: string;
    postgres: {
      database: string;
      sizeInBytes: number;
      counts: BackupPostgresCounts;
    } | null;
    clickhouse: { database: string; sizeInBytes: number } | null;
  };
  problems: Array<RestoreIssue>;
  warnings: Array<RestoreIssue>;
}

export interface FindBackupsResult {
  found: number;
  added: number;
  updated: number;
  removed: number;
}

const BASE_ROUTE: string = "/backup";

async function send(data: {
  method: "get" | "post";
  path: string;
  body?: JSONObject | undefined;
}): Promise<JSONObject> {
  const url: URL = URL.fromURL(APP_API_URL).addRoute(
    `${BASE_ROUTE}${data.path}`,
  );
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    data.method === "get"
      ? await API.get<JSONObject>({
          url,
          headers: AdminModelAPI.getCommonHeaders(),
        })
      : await API.post<JSONObject>({
          url,
          headers: AdminModelAPI.getCommonHeaders(),
          data: data.body || {},
        });

  if (response instanceof HTTPErrorResponse) {
    throw new Error(API.getFriendlyMessage(response));
  }

  return (response.data || {}) as JSONObject;
}

function readText(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

export default class BackupsApi {
  public static async getOverview(): Promise<BackupsOverview> {
    const data: JSONObject = await send({ method: "get", path: "/overview" });

    return {
      isSetUp: data["isSetUp"] === true,
      isActive: data["isActive"] !== false,
      isAvailable: data["isAvailable"] !== false,
      nextBackupAt: readText(data["nextBackupAt"]),
      location: readText(data["location"]),
      destinationFingerprint: readText(data["destinationFingerprint"]),
      destinationError: readText(data["destinationError"]),
      postgres: (data["postgres"] as BackupsOverview["postgres"]) || null,
      clickhouse: (data["clickhouse"] as BackupsOverview["clickhouse"]) || null,
    };
  }

  public static async test(body: JSONObject): Promise<BackupTestResult> {
    const data: JSONObject = await send({
      method: "post",
      path: "/test",
      body,
    });
    const checks: Array<BackupTestCheck> = Array.isArray(data["checks"])
      ? (data["checks"] as unknown as Array<BackupTestCheck>)
      : [];

    return { isSuccessful: data["isSuccessful"] === true, checks };
  }

  public static async runNow(): Promise<string> {
    const data: JSONObject = await send({ method: "post", path: "/run-now" });
    return String(data["backupRunId"] || "");
  }

  public static async getRestorePreview(data: {
    backupRunId: string;
    includesPostgres: boolean;
    includesClickhouse: boolean;
  }): Promise<RestorePreview> {
    return (await send({
      method: "post",
      path: "/restore-preview",
      body: data,
    })) as unknown as RestorePreview;
  }

  public static async restore(data: {
    backupRunId: string;
    includesPostgres: boolean;
    includesClickhouse: boolean;
    takeBackupFirst: boolean;
    confirmation: string;
  }): Promise<string> {
    const answer: JSONObject = await send({
      method: "post",
      path: "/restore",
      body: data,
    });

    return String(answer["backupRunId"] || "");
  }

  public static async cancel(backupRunId: string): Promise<void> {
    await send({ method: "post", path: "/cancel", body: { backupRunId } });
  }

  public static async delete(backupRunId: string): Promise<void> {
    await send({ method: "post", path: "/delete", body: { backupRunId } });
  }

  public static async find(): Promise<FindBackupsResult> {
    const data: JSONObject = await send({ method: "post", path: "/find" });

    return {
      found: Number(data["found"] || 0),
      added: Number(data["added"] || 0),
      updated: Number(data["updated"] || 0),
      removed: Number(data["removed"] || 0),
    };
  }
}
