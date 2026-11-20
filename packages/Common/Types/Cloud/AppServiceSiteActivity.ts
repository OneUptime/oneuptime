import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT AZURE SAYS OF AN APP SERVICE APP'S INSTANCES AND DEPLOYMENTS
 * (#10294).
 *
 * An App Platforms app names its instances and its revision only through
 * the resource attributes of the telemetry it sends (service.instance.id,
 * service.version): an App Service app that sends neither read "Not
 * reported" and "No revision reported yet", though Azure knows both.
 * Resource Manager answers them for any reader of the site (the Monitoring
 * Reader role a cloud connection's app has):
 *
 *   GET {site}/instances?api-version=2023-12-01
 *       -> its scale-out instances: each one's name is its instance id,
 *          the WEBSITE_INSTANCE_ID the App Service resource detectors put
 *          in service.instance.id, and its properties.state READY,
 *          STOPPED or UNKNOWN ("Web Apps - List Instance Identifiers");
 *   GET {site}/deployments?api-version=2023-12-01
 *       -> its deployments, newest first as Kudu keeps them: id, status
 *          (Kudu's DeployStatus: 0 pending, 1 building, 2 deploying,
 *          3 failed, 4 succeeded), whether it is the active one, author,
 *          deployer ("GITHUB_ZIP_DEPLOY", "OneDeploy"), message and times
 *          ("Web Apps - List Deployments");
 *   GET {site}/config/web?api-version=2023-12-01
 *       -> its configuration: linuxFxVersion or windowsFxVersion
 *          ("DOCKER|registry/checkout:1.4.2") name the image a container
 *          app runs. Never its app settings, which Resource Manager keeps
 *          behind a list action no reader is given.
 *
 * This file reads those answers - only the fields named here - into what
 * an app's page shows, React-free and server-free so both the read and the
 * page use it, and tests feed it Azure's own answers.
 */

export const APP_SERVICE_SITE_API_VERSION: string = "2023-12-01";

/*
 * Where the page asks for a site's activity: POST
 * {APP_SERVICE_SITE_ACTIVITY_API_PATH}/:cloudResourceId/activity
 * (CloudConnectionAPI), for whoever may read the site.
 */
export const APP_SERVICE_SITE_ACTIVITY_API_PATH: string =
  "/cloud-connection/app-service-site";

// The most instances and deployments kept from one read.
export const APP_SERVICE_MAX_INSTANCES: number = 100;
export const APP_SERVICE_MAX_DEPLOYMENTS: number = 20;
// The longest text kept of a deployment's message, author or deployer.
export const APP_SERVICE_MAX_TEXT_LENGTH: number = 200;

// An instance's runtime state, as Resource Manager writes it (SiteRuntimeState).
export enum AppServiceInstanceState {
  Ready = "READY",
  Stopped = "STOPPED",
  Unknown = "UNKNOWN",
}

export interface AppServiceSiteInstance {
  // The instance id: WEBSITE_INSTANCE_ID on the instance itself.
  id: string;
  state: AppServiceInstanceState;
}

// A deployment's outcome, from Kudu's DeployStatus.
export enum AppServiceDeploymentStatus {
  Pending = "pending",
  InProgress = "in-progress",
  Failed = "failed",
  Succeeded = "succeeded",
  Unknown = "unknown",
}

export interface AppServiceSiteDeployment {
  // Kudu's id: a commit for a Git deployment, a GUID for a ZIP one.
  id: string;
  status: AppServiceDeploymentStatus;
  // Whether it is the deployment the site runs now.
  active: boolean;
  author: string;
  deployer: string;
  message: string;
  // ISO times; null when Azure does not say.
  startTime: string | null;
  endTime: string | null;
}

// Why a part of a read could not be read; the page says it in the reader's words.
export enum AppServiceSiteReadError {
  // Azure refused the connection's app (403): it lacks a role.
  NoAccess = "no-access",
  // Azure has no such app (404): deleted or moved since it was listed.
  NotFound = "not-found",
  // Asked too often: OneUptime's limit, or Azure's (429).
  Busy = "busy",
  // Anything else Azure or the network answered.
  Failed = "failed",
}

// One part of a read: what it answered, or why it could not.
export interface AppServiceSiteActivityPart<T> {
  items: Array<T> | null;
  // Set when the part could not be read.
  error?: AppServiceSiteReadError | undefined;
}

export interface AppServiceSiteActivity {
  // ISO time of the read.
  readAt: string;
  instances: AppServiceSiteActivityPart<AppServiceSiteInstance>;
  deployments: AppServiceSiteActivityPart<AppServiceSiteDeployment>;
  // The image a container app runs; null for a code app, or when unread.
  image: string | null;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readText(value: JSONValue | undefined): string {
  if (typeof value === "string") {
    return value.trim().slice(0, APP_SERVICE_MAX_TEXT_LENGTH);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

// The longest ARM id read: ids are far shorter.
const MAX_ID_LENGTH: number = 1024;

// An ARM id as text, read whole up to MAX_ID_LENGTH: a text's cap would cut its end.
function readId(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_ID_LENGTH) : "";
}

function readTime(value: JSONValue | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time: number = Date.parse(value);

  // Kudu writes "0001-01-01T00:00:00" for a time it does not have.
  if (!Number.isFinite(time) || time <= 0) {
    return null;
  }

  return new Date(time).toISOString();
}

// The last segment of an ARM id: an instance's or a deployment's own name.
function lastSegment(id: string): string {
  const parts: Array<string> = id.split("/").filter((part: string) => {
    return part.length > 0;
  });

  return parts[parts.length - 1] || "";
}

// What a deployment's status number means (Kudu's DeployStatus).
export function readAppServiceDeploymentStatus(
  value: JSONValue | undefined,
): AppServiceDeploymentStatus {
  const status: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  switch (status) {
    case 0:
      return AppServiceDeploymentStatus.Pending;
    case 1:
    case 2:
      return AppServiceDeploymentStatus.InProgress;
    case 3:
      return AppServiceDeploymentStatus.Failed;
    case 4:
      return AppServiceDeploymentStatus.Succeeded;
    default:
      return AppServiceDeploymentStatus.Unknown;
  }
}

function readInstanceState(
  value: JSONValue | undefined,
): AppServiceInstanceState {
  const state: string = readText(value).toUpperCase();

  return state === AppServiceInstanceState.Ready
    ? AppServiceInstanceState.Ready
    : state === AppServiceInstanceState.Stopped
      ? AppServiceInstanceState.Stopped
      : AppServiceInstanceState.Unknown;
}

/*
 * The instances of a "List Instance Identifiers" answer's value[], by
 * their id, each once, at most APP_SERVICE_MAX_INSTANCES.
 */
export function readAppServiceInstances(
  items: ReadonlyArray<JSONValue>,
): Array<AppServiceSiteInstance> {
  const instances: Array<AppServiceSiteInstance> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of items) {
    const row: JSONObject | null = readObject(item);

    if (!row) {
      continue;
    }

    // ARM may name a child "site/instance": the instance is the last part.
    const id: string = (
      lastSegment(readId(row["name"])) || lastSegment(readId(row["id"]))
    ).slice(0, APP_SERVICE_MAX_TEXT_LENGTH);

    if (!id || seen.has(id.toLowerCase())) {
      continue;
    }

    seen.add(id.toLowerCase());
    instances.push({
      id,
      state: readInstanceState(readObject(row["properties"])?.["state"]),
    });

    if (instances.length >= APP_SERVICE_MAX_INSTANCES) {
      break;
    }
  }

  return instances;
}

/*
 * The deployments of a "List Deployments" answer's value[], newest first
 * (by when each ended, else began), at most APP_SERVICE_MAX_DEPLOYMENTS.
 */
export function readAppServiceDeployments(
  items: ReadonlyArray<JSONValue>,
): Array<AppServiceSiteDeployment> {
  const deployments: Array<AppServiceSiteDeployment> = [];

  for (const item of items) {
    const row: JSONObject | null = readObject(item);

    if (!row) {
      continue;
    }

    const properties: JSONObject = readObject(row["properties"]) || {};
    // ARM names a deployment "site/deployment": the deployment is the last part.
    const id: string = (
      readText(properties["id"]) ||
      lastSegment(readId(row["name"])) ||
      lastSegment(readId(row["id"]))
    ).slice(0, APP_SERVICE_MAX_TEXT_LENGTH);

    if (!id) {
      continue;
    }

    deployments.push({
      id,
      status: readAppServiceDeploymentStatus(properties["status"]),
      active: properties["active"] === true,
      author: readText(properties["author"]),
      deployer: readText(properties["deployer"]),
      message: readText(properties["message"]),
      startTime: readTime(properties["start_time"]),
      endTime: readTime(properties["end_time"]),
    });
  }

  const timeOf: (deployment: AppServiceSiteDeployment) => number = (
    deployment: AppServiceSiteDeployment,
  ): number => {
    const time: string | null = deployment.endTime || deployment.startTime;

    return time ? Date.parse(time) : 0;
  };

  return deployments
    .sort((a: AppServiceSiteDeployment, b: AppServiceSiteDeployment) => {
      return timeOf(b) - timeOf(a);
    })
    .slice(0, APP_SERVICE_MAX_DEPLOYMENTS);
}

/*
 * The image a container app runs, from its configuration's linuxFxVersion
 * or windowsFxVersion ("DOCKER|registry/checkout:1.4.2"). A code app's is
 * its stack ("NODE|20-lts") and a Compose app's a whole file, neither an
 * image: null for those, and when the answer says neither.
 */
export function readAppServiceImage(
  config: JSONObject | null | undefined,
): string | null {
  const properties: JSONObject = readObject(config?.["properties"]) || {};

  for (const key of ["linuxFxVersion", "windowsFxVersion"]) {
    const value: string = readText(properties[key]);
    const separator: number = value.indexOf("|");

    if (separator <= 0) {
      continue;
    }

    const kind: string = value.slice(0, separator).toUpperCase();
    const image: string = value.slice(separator + 1).trim();

    if (kind === "DOCKER" && image) {
      return image;
    }
  }

  return null;
}

// The deployment the site runs now: the active one, else the newest that succeeded.
export function getAppServiceCurrentDeployment(
  deployments: ReadonlyArray<AppServiceSiteDeployment> | null | undefined,
): AppServiceSiteDeployment | null {
  if (!deployments || deployments.length === 0) {
    return null;
  }

  return (
    deployments.find((deployment: AppServiceSiteDeployment): boolean => {
      return deployment.active;
    }) ||
    deployments.find((deployment: AppServiceSiteDeployment): boolean => {
      return deployment.status === AppServiceDeploymentStatus.Succeeded;
    }) ||
    null
  );
}

// The instances Azure says run: ready, or of a state it does not say.
export function getAppServiceRunningInstances(
  instances: ReadonlyArray<AppServiceSiteInstance> | null | undefined,
): Array<AppServiceSiteInstance> {
  return (instances || []).filter(
    (instance: AppServiceSiteInstance): boolean => {
      return instance.state !== AppServiceInstanceState.Stopped;
    },
  );
}

// A read's JSON, read back on the page; anything else is no read.
export function readAppServiceSiteActivity(
  value: unknown,
): AppServiceSiteActivity | null {
  const json: JSONObject | null = readObject(value as JSONValue);

  if (!json || typeof json["readAt"] !== "string") {
    return null;
  }

  const part: <T>(
    raw: JSONValue | undefined,
    read: (items: ReadonlyArray<JSONValue>) => Array<T>,
  ) => AppServiceSiteActivityPart<T> = <T>(
    raw: JSONValue | undefined,
    read: (items: ReadonlyArray<JSONValue>) => Array<T>,
  ): AppServiceSiteActivityPart<T> => {
    const object: JSONObject = readObject(raw) || {};
    const items: JSONValue | undefined = object["items"];
    const error: string = readText(object["error"]);

    return {
      items: Array.isArray(items) ? read(items) : null,
      ...(error
        ? {
            error: (
              Object.values(AppServiceSiteReadError) as Array<string>
            ).includes(error)
              ? (error as AppServiceSiteReadError)
              : AppServiceSiteReadError.Failed,
          }
        : {}),
    };
  };

  return {
    readAt: json["readAt"] as string,
    instances: part(json["instances"], (items: ReadonlyArray<JSONValue>) => {
      return items
        .map((item: JSONValue): AppServiceSiteInstance | null => {
          const row: JSONObject | null = readObject(item);
          const id: string = row ? readText(row["id"]) : "";

          return id ? { id, state: readInstanceState(row?.["state"]) } : null;
        })
        .filter((item: AppServiceSiteInstance | null) => {
          return item !== null;
        }) as Array<AppServiceSiteInstance>;
    }),
    deployments: part(
      json["deployments"],
      (items: ReadonlyArray<JSONValue>) => {
        return items
          .map((item: JSONValue): AppServiceSiteDeployment | null => {
            const row: JSONObject | null = readObject(item);
            const id: string = row ? readText(row["id"]) : "";
            const status: string = row ? readText(row["status"]) : "";

            return row && id
              ? {
                  id,
                  status: (
                    Object.values(AppServiceDeploymentStatus) as Array<string>
                  ).includes(status)
                    ? (status as AppServiceDeploymentStatus)
                    : AppServiceDeploymentStatus.Unknown,
                  active: row["active"] === true,
                  author: readText(row["author"]),
                  deployer: readText(row["deployer"]),
                  message: readText(row["message"]),
                  startTime: readTime(row["startTime"]),
                  endTime: readTime(row["endTime"]),
                }
              : null;
          })
          .filter((item: AppServiceSiteDeployment | null) => {
            return item !== null;
          }) as Array<AppServiceSiteDeployment>;
      },
    ),
    image: readText(json["image"]) || null,
  };
}
