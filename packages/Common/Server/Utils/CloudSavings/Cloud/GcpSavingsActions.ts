import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
  CloudSavingsTargetType,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { splitCloudConnectionList } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { CLOUD_SAVINGS_ACTION_TAG_KEY } from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  readCloudSetting,
} from "../../CloudConnection/CloudConnectorTypes";
import { withCloudRetries } from "../../CloudConnection/CloudRetry";
import GcpCloudConnector from "../../CloudConnection/Gcp/GcpCloudConnector";
import GcpInventoryClient from "../../CloudConnection/Gcp/GcpInventory";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudSavingsProgress,
  CloudSavingsRun,
  CloudSavingsStepContext,
  CloudSavingsStepOutcome,
  CloudSavingsUndoRun,
  done,
  getFinalSnapshotName,
  waiting,
} from "../CloudSavingsCloudTypes";

/*
 * ACTING ON A SAVING IN GOOGLE CLOUD (#11010), through the connection's
 * opt-in custom role, oneuptimeSavingsActions (CloudSavingsActionsAccess),
 * on Compute Engine's API (v1).
 *
 *   StopInstance     instances.get, then instances.stop; undone with
 *                    instances.start.
 *   DeleteVolume     disks.get (attached to nothing only), a final snapshot
 *                    (disks.createSnapshot) and snapshots.get until it is
 *                    READY, then disks.delete; undone by disks.insert from
 *                    that snapshot, of the disk's name, type and size, with
 *                    its labels. A zone's disks and a Region's alike.
 *   ReleaseAddress   addresses.get (used by nothing only), then
 *                    addresses.delete - a Region's or the global ones.
 *                    Never undone: the address goes back to Google.
 *   DeleteImage      images.get, then images.delete. Never undone.
 *   ResizeInstance   instances.get, instances.stop and wait until it is
 *                    TERMINATED, instances.setMachineType, instances.start
 *                    when it was running; undone the same way back.
 *
 * Each write is an operation Google runs on its own; it is never polled.
 * The next step reads the resource itself instead - a snapshot READY, an
 * instance TERMINATED, its machine type changed - so a step that waits
 * goes on from what the resource is, whatever became of the operation.
 * Every step reads before it writes, so run twice it does no more than
 * once. A refusal says which permission the service account lacks and
 * which setting grants it; anything else is said in Google's words. A
 * connection that names its projects changes nothing outside them.
 */

const PROVIDER_TITLE: string = "Google Cloud";
const COMPUTE_BASE_URL: string = "https://compute.googleapis.com/compute/v1";
const COMPUTE_API: string = "compute.googleapis.com";
// The narrowest scope that lets Compute Engine stop, delete and resize.
export const GCP_COMPUTE_SCOPE: string =
  "https://www.googleapis.com/auth/compute";
const DEFAULT_MAX_REQUESTS: number = 20;
const DEFAULT_MAX_DURATION_MS: number = 2 * 60 * 1000;
// A snapshot not found yet this many waits after it was asked for has failed.
const SNAPSHOT_NOT_FOUND_WAITS: number = 3;

// The permission each call needs, named in a refusal - each one Savings actions grants.
const INSTANCE_GET: string = "compute.instances.get";
const INSTANCE_STOP: string = "compute.instances.stop";
const INSTANCE_START: string = "compute.instances.start";
const INSTANCE_SET_MACHINE_TYPE: string = "compute.instances.setMachineType";
const DISK_GET: string = "compute.disks.get";
const DISK_CREATE_SNAPSHOT: string = "compute.disks.createSnapshot";
const SNAPSHOT_CREATE: string = "compute.snapshots.create";
const SNAPSHOT_GET: string = "compute.snapshots.get";
const DISK_DELETE: string = "compute.disks.delete";
const DISK_CREATE: string = "compute.disks.create";
const SNAPSHOT_USE_READ_ONLY: string = "compute.snapshots.useReadOnly";
const ADDRESS_GET: string = "compute.addresses.get";
const ADDRESS_DELETE: string = "compute.addresses.delete";
const GLOBAL_ADDRESS_GET: string = "compute.globalAddresses.get";
const GLOBAL_ADDRESS_DELETE: string = "compute.globalAddresses.delete";
const IMAGE_GET: string = "compute.images.get";
const IMAGE_DELETE: string = "compute.images.delete";

/*
 * Every permission these calls need: a refusal that names one of them (as
 * Google's "Required 'compute.snapshots.create' permission" does) is said
 * with that one, since one call can need two.
 */
const PERMISSIONS: ReadonlyArray<string> = [
  INSTANCE_GET,
  INSTANCE_STOP,
  INSTANCE_START,
  INSTANCE_SET_MACHINE_TYPE,
  DISK_GET,
  DISK_CREATE_SNAPSHOT,
  SNAPSHOT_CREATE,
  SNAPSHOT_GET,
  DISK_DELETE,
  DISK_CREATE,
  SNAPSHOT_USE_READ_ONLY,
  ADDRESS_GET,
  ADDRESS_DELETE,
  GLOBAL_ADDRESS_GET,
  GLOBAL_ADDRESS_DELETE,
  IMAGE_GET,
  IMAGE_DELETE,
];

// The one permission only the resize choice grants.
const RESIZE_PERMISSIONS: ReadonlyArray<string> = [INSTANCE_SET_MACHINE_TYPE];

// What Google names in a refusal: "Required 'compute.disks.delete' permission for ...".
const REQUIRED_PERMISSION: RegExp = /Required '([a-zA-Z.]+)' permission/;

// An instance that is up, or on its way up: a stop is what makes it down.
const UP_STATES: ReadonlyArray<string> = ["RUNNING", "PROVISIONING", "STAGING"];
// An instance that is down: Google bills none of its compute.
const DOWN_STATES: ReadonlyArray<string> = ["TERMINATED", "STOPPED"];

interface GcpCall {
  token: GoogleServiceAccountToken;
  transport: CloudConnectorTransport;
  budget: CloudReadBudget;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  target: CloudSavingsTarget;
  // What the resource is called in a sentence: "instance web-1", "disk data-old".
  what: string;
}

function describeTarget(target: CloudSavingsTarget): string {
  switch (target.type) {
    case CloudSavingsTargetType.Instance:
      return `instance ${target.id}`;
    case CloudSavingsTargetType.Volume:
      return `disk ${target.id}`;
    case CloudSavingsTargetType.Address:
      return `address ${target.id}`;
    case CloudSavingsTargetType.Image:
      return `image ${target.id}`;
    default:
      return target.id;
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * The resource a change is made to, in a project the connection reads, and
 * a token of the narrowest scope that may change it.
 */
function open(
  context: CloudSavingsStepContext,
  target: CloudSavingsTarget,
): GcpCall {
  const connector: GcpCloudConnector = new GcpCloudConnector();
  const settings: CloudConnectionSettings = context.settings;

  connector.validateSettings(settings);

  if (target.provider !== CloudProvider.GCP || !target.account) {
    throw new BadDataException(
      `${capitalized(describeTarget(target))} is not a Google Cloud resource OneUptime can change.`,
    );
  }

  /*
   * The projects it reads: the ones it names, else its key's own - or, for
   * a whole organization that names none, any of the organization's.
   */
  const named: Array<string> = splitCloudConnectionList(
    readCloudSetting(settings.config, "projectIds"),
  );
  const allowed: Array<string> =
    named.length === 0 && connector.isOrganization(settings)
      ? []
      : connector.getProjects(settings);

  if (allowed.length > 0 && !allowed.includes(target.account)) {
    throw new BadDataException(
      `${capitalized(describeTarget(target))} is in project ${target.account}, which this connection does not read.`,
    );
  }

  const transport: CloudConnectorTransport =
    context.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);

  return {
    token: new GoogleServiceAccountToken({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      scope: GCP_COMPUTE_SCOPE,
      transport,
      providerTitle: PROVIDER_TITLE,
    }),
    transport,
    budget:
      context.budget ||
      new CloudReadBudget({
        maxRequests: DEFAULT_MAX_REQUESTS,
        maxDurationMs: DEFAULT_MAX_DURATION_MS,
      }),
    sleep: context.sleep,
    target,
    what: describeTarget(target),
  };
}

// A path under the project, each part encoded: "zones/us-central1-a/instances/web-1".
function pathOf(call: GcpCall, ...parts: Array<string>): string {
  return ["projects", call.target.account, ...parts]
    .map((part: string): string => {
      return encodeURIComponent(part);
    })
    .join("/");
}

// Where a zone's or a Region's resource of a collection is: "zones/z/disks", "regions/r/disks".
function placeOf(call: GcpCall): Array<string> {
  return call.target.gcpScope === "region"
    ? ["regions", call.target.location]
    : call.target.gcpScope === "global"
      ? ["global"]
      : ["zones", call.target.location];
}

/*
 * One request: a request of the budget, a burst's 429 asked again (each
 * write sets what it sets, or is refused as already done), and a failure
 * classified as the inventory classifies it.
 */
async function request(
  call: GcpCall,
  data: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: JSONObject | undefined;
    step: string;
  },
): Promise<JSONObject> {
  return await withCloudRetries({
    sleep: call.sleep,
    call: async (): Promise<JSONObject> => {
      if (!call.budget.take()) {
        throw new CloudReadBudgetSpent();
      }

      const accessToken: string = await call.token.getAccessToken();

      try {
        const response: DataSourceHttpResponse = await LlmProviderHttp.send({
          transport: call.transport,
          method: data.method,
          url: `${COMPUTE_BASE_URL}/${data.path}`,
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
        throw GcpInventoryClient.classify(error, COMPUTE_API);
      }
    },
  });
}

// What Google said of a failure, in its own words, and the reason it gave.
function googleErrorOf(error: unknown): { message: string; reason: string } {
  if (error instanceof LlmProviderError) {
    try {
      const failure: JSONObject = readObject(
        readObject(JSON.parse(error.responseBody || "{}"))["error"],
      );
      const message: string = readText(failure["message"]);

      if (message) {
        return {
          message,
          reason: readText(
            readObject(readArray(failure["errors"])[0])["reason"],
          ),
        };
      }
    } catch {
      // Not JSON: the error's own message says it.
    }

    return { message: error.message, reason: "" };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    reason: "",
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof LlmProviderError && error.statusCode === 404;
}

// Google's words for what its reasons say, should a reason not be read.
const ALREADY_EXISTS_WORDS: RegExp = /already exists/i;
const IN_USE_WORDS: RegExp = /already being used by|in use/i;

// Whether Google answered that what was asked for is there already (409 alreadyExists).
function isAlreadyThere(error: unknown): boolean {
  if (!(error instanceof LlmProviderError) || error.statusCode !== 409) {
    return false;
  }

  const google: { message: string; reason: string } = googleErrorOf(error);

  return (
    google.reason === "alreadyExists" ||
    ALREADY_EXISTS_WORDS.test(google.message)
  );
}

// Whether Google refused because something uses the resource (400 resourceInUseByAnotherResource).
function isInUse(error: unknown): boolean {
  if (!(error instanceof LlmProviderError) || error.statusCode !== 400) {
    return false;
  }

  const google: { message: string; reason: string } = googleErrorOf(error);

  return (
    google.reason === "resourceInUseByAnotherResource" ||
    IN_USE_WORDS.test(google.message)
  );
}

/*
 * A refusal, said with the permission the service account lacks - the one
 * Google named, when it is one of these calls' - and the setting that
 * grants it; a resource that is gone as what it is; anything else as
 * Google said it.
 */
function explain(
  error: unknown,
  data: { what: string; permission: string },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    const match: RegExpMatchArray | null =
      googleErrorOf(error).message.match(REQUIRED_PERMISSION);
    const permission: string =
      match && PERMISSIONS.includes(match[1]!) ? match[1]! : data.permission;

    return new LlmProviderError({
      message: `Google Cloud refused ${permission} on ${data.what}: the service account may not do it. Set the connection's Savings actions to ${
        RESIZE_PERMISSIONS.includes(permission)
          ? '"Stop, start, clean up and resize"'
          : "on"
      }, and run its setup command again.`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  if (error.statusCode === 404) {
    return new LlmProviderError({
      message: `${capitalized(data.what)} was not found: it may have been deleted.`,
      kind: CloudConnectionFailureKind.Settings,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

function expectType(
  call: GcpCall,
  type: CloudSavingsTargetType,
  kind: CloudSavingsActionKind,
): void {
  if (call.target.type !== type) {
    throw new BadDataException(
      `OneUptime does not make a change of this kind to ${call.what}: ${kind}.`,
    );
  }
}

// The name at the end of a URL: a machine type's, a disk type's, an instance's.
function lastPartOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

/*
 * A label value Google takes: lower case letters, digits, "_" and "-", at
 * most 63 - the action's id, as written.
 */
function labelValueOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 63);
}

/*
 * ---------------------------------------------------------------------------
 * Instances
 * ---------------------------------------------------------------------------
 */

interface GcpInstance {
  status: string;
  machineType: string;
}

async function readInstance(call: GcpCall): Promise<GcpInstance | null> {
  let instance: JSONObject;

  try {
    instance = await request(call, {
      method: "GET",
      path: pathOf(call, ...placeOf(call), "instances", call.target.id),
      step: "instance request",
    });
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw explain(error, { what: call.what, permission: INSTANCE_GET });
  }

  return {
    status: readText(instance["status"]),
    machineType: lastPartOf(readText(instance["machineType"])),
  };
}

function instanceGone(call: GcpCall): BadDataException {
  return new BadDataException(
    `${capitalized(call.what)} was not found: it may have been deleted.`,
  );
}

async function instanceAction(
  call: GcpCall,
  action: "stop" | "start",
): Promise<void> {
  try {
    await request(call, {
      method: "POST",
      path: pathOf(call, ...placeOf(call), "instances", call.target.id, action),
      step: action === "stop" ? "instance stop" : "instance start",
    });
  } catch (error) {
    throw explain(error, {
      what: call.what,
      permission: action === "stop" ? INSTANCE_STOP : INSTANCE_START,
    });
  }
}

async function stopInstance(
  call: GcpCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const instance: GcpInstance | null = await readInstance(call);

  if (!instance) {
    throw instanceGone(call);
  }

  if (
    [...DOWN_STATES, "STOPPING", "SUSPENDING", "SUSPENDED"].includes(
      instance.status,
    )
  ) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already stopped; nothing changed.`,
    });
  }

  if (!UP_STATES.includes(instance.status)) {
    throw new BadDataException(
      `${capitalized(call.what)} is ${instance.status} now, so it cannot be stopped. Try again once it is running.`,
    );
  }

  await instanceAction(call, "stop");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Stopped ${call.what}. Its disks are kept, and it can be started again.`,
  });
}

async function startInstance(
  call: GcpCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const instance: GcpInstance | null = await readInstance(call);

  if (!instance) {
    throw instanceGone(call);
  }

  if (UP_STATES.includes(instance.status)) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already running; nothing changed.`,
    });
  }

  // A stop still under way: Google refuses a start until it has stopped.
  if (instance.status === "STOPPING") {
    return waiting(run.progress, `Waiting for ${call.what} to stop.`);
  }

  if (!DOWN_STATES.includes(instance.status)) {
    throw new BadDataException(
      `${capitalized(call.what)} is ${instance.status} now, so it was not started. Resume or start it in the Google Cloud console.`,
    );
  }

  await instanceAction(call, "start");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Started ${call.what} again.`,
  });
}

/*
 * A resize, in its steps: stop (when running), wait until stopped, set the
 * machine type, then - once the instance says it has the new type - start
 * it again when it was running. A type Google will not set starts the
 * instance again before the failure is said.
 */
async function resizeInstance(
  call: GcpCall,
  run: CloudSavingsRun,
  to: string,
): Promise<CloudSavingsStepOutcome> {
  let progress: CloudSavingsProgress = { ...run.progress };

  for (;;) {
    const step: string = progress.step || "start";

    if (step === "start") {
      const instance: GcpInstance | null = await readInstance(call);

      if (!instance) {
        throw instanceGone(call);
      }

      if (instance.machineType === to) {
        return done({
          progress,
          changed: false,
          summary: `${capitalized(call.what)} was already ${to}; nothing changed.`,
        });
      }

      const isUp: boolean = UP_STATES.includes(instance.status);

      progress = {
        ...progress,
        previous: progress.previous || instance.machineType,
        wasRunning: isUp,
      };

      if (isUp) {
        await instanceAction(call, "stop");
        progress.step = "wait-stopped";
        return waiting(
          progress,
          `Stopping ${call.what} to resize it to ${to}.`,
        );
      }

      if (instance.status === "STOPPING") {
        progress.step = "wait-stopped";
        continue;
      }

      if (!DOWN_STATES.includes(instance.status)) {
        throw new BadDataException(
          `${capitalized(call.what)} is ${instance.status} now, so it cannot be resized. Try again once it is running or stopped.`,
        );
      }

      progress.step = "modify";
      continue;
    }

    if (step === "wait-stopped") {
      const instance: GcpInstance | null = await readInstance(call);

      if (!instance) {
        throw instanceGone(call);
      }

      if (!DOWN_STATES.includes(instance.status)) {
        return waiting(progress, `Waiting for ${call.what} to stop.`);
      }

      progress.step = "modify";
      continue;
    }

    if (step === "modify") {
      try {
        await request(call, {
          method: "POST",
          path: pathOf(
            call,
            ...placeOf(call),
            "instances",
            call.target.id,
            "setMachineType",
          ),
          body: {
            machineType: `zones/${call.target.location}/machineTypes/${to}`,
          },
          step: "instance machine type update",
        });
      } catch (error) {
        // Never leave a running instance stopped because its resize failed.
        if (progress.wasRunning) {
          await instanceAction(call, "start");
        }

        if (
          error instanceof LlmProviderError &&
          error.kind !== CloudConnectionFailureKind.Permission &&
          error.statusCode === 400
        ) {
          throw new BadDataException(
            `Google Cloud would not make ${call.what} a ${to}, so it was left a ${progress.previous || "the size it was"}${
              progress.wasRunning ? " and started again" : ""
            }: ${googleErrorOf(error).message}`,
          );
        }

        throw explain(error, {
          what: call.what,
          permission: INSTANCE_SET_MACHINE_TYPE,
        });
      }

      if (!progress.wasRunning) {
        return done({
          progress,
          changed: true,
          summary: `Resized ${call.what} from ${progress.previous} to ${to}. It was stopped, and is left stopped.`,
        });
      }

      progress.step = "start-again";
      continue;
    }

    if (step === "start-again") {
      const instance: GcpInstance | null = await readInstance(call);

      if (!instance) {
        throw instanceGone(call);
      }

      // The machine type is set by an operation of Google's own: started once it has.
      if (instance.machineType !== to) {
        return waiting(
          progress,
          `Waiting for Google Cloud to resize ${call.what} to ${to}.`,
        );
      }

      await instanceAction(call, "start");

      return done({
        progress,
        changed: true,
        summary: `Resized ${call.what} from ${progress.previous} to ${to}, and started it again.`,
      });
    }

    return done({
      progress,
      changed: true,
      summary: `Resized ${call.what} to ${to}.`,
    });
  }
}

/*
 * ---------------------------------------------------------------------------
 * Disks, addresses and images
 * ---------------------------------------------------------------------------
 */

/*
 * An unattached disk deleted, in its steps: read it (still unattached),
 * its final snapshot asked for and read until READY, then the delete. What
 * it was is kept, to make it again from the snapshot.
 */
async function deleteDisk(
  call: GcpCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const diskPath: string = pathOf(
    call,
    ...placeOf(call),
    "disks",
    call.target.id,
  );
  let progress: CloudSavingsProgress = { ...run.progress };

  for (;;) {
    const step: string = progress.step || "start";

    if (step === "start") {
      let disk: JSONObject;

      try {
        disk = await request(call, {
          method: "GET",
          path: diskPath,
          step: "disk request",
        });
      } catch (error) {
        if (isNotFound(error)) {
          return done({
            progress,
            changed: false,
            summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
          });
        }

        throw explain(error, { what: call.what, permission: DISK_GET });
      }

      const users: Array<string> = readArray(disk["users"]).map(
        (user: unknown): string => {
          return String(user);
        },
      );
      const status: string = readText(disk["status"]);

      if (users.length > 0) {
        throw new BadDataException(
          `${capitalized(call.what)} is attached to ${lastPartOf(users[0]!)} now, so it was not deleted.`,
        );
      }

      if (status && status !== "READY") {
        throw new BadDataException(
          `${capitalized(call.what)} is ${status} now, so it was not deleted.`,
        );
      }

      progress = {
        ...progress,
        disk: {
          type: lastPartOf(readText(disk["type"])),
          sizeGb: Number(readText(disk["sizeGb"]) || disk["sizeGb"]) || 0,
          labels: readObject(disk["labels"]),
          replicaZones: readArray(disk["replicaZones"]).map(
            (zone: unknown): string => {
              return String(zone);
            },
          ),
        },
        step: run.finalSnapshot ? "snapshot" : "delete",
      };
      continue;
    }

    if (step === "snapshot") {
      const name: string = getFinalSnapshotName(call.target.id, run.actionId);

      try {
        await request(call, {
          method: "POST",
          path: `${diskPath}/createSnapshot`,
          body: {
            name,
            description: `Final snapshot OneUptime took before deleting ${call.target.id} (savings action ${run.actionId}).`,
            labels: {
              [CLOUD_SAVINGS_ACTION_TAG_KEY]: labelValueOf(run.actionId),
            },
          },
          step: "final snapshot",
        });
      } catch (error) {
        // Asked for before, its answer lost: the snapshot is the one to wait for.
        if (!isAlreadyThere(error)) {
          throw explain(error, {
            what: call.what,
            permission: DISK_CREATE_SNAPSHOT,
          });
        }
      }

      progress = { ...progress, snapshotId: name, step: "wait-snapshot" };
      return waiting(
        progress,
        `Taking a final snapshot of ${call.what} (${name}) before deleting it.`,
      );
    }

    if (step === "wait-snapshot") {
      const name: string = progress.snapshotId || "";
      let status: string = "";

      try {
        status = readText(
          (
            await request(call, {
              method: "GET",
              path: pathOf(call, "global", "snapshots", name),
              step: "final snapshot request",
            })
          )["status"],
        );
      } catch (error) {
        if (!isNotFound(error)) {
          throw explain(error, {
            what: `snapshot ${name}`,
            permission: SNAPSHOT_GET,
          });
        }

        // Not there yet, a moment after it was asked for; gone, after a few.
        status =
          (progress.waits || 0) >= SNAPSHOT_NOT_FOUND_WAITS
            ? "FAILED"
            : "CREATING";
      }

      if (status === "FAILED") {
        throw new BadDataException(
          `The final snapshot of ${call.what} failed, so the disk was not deleted.`,
        );
      }

      if (status !== "READY") {
        return waiting(
          progress,
          `Waiting for the final snapshot of ${call.what} (${name}) to complete.`,
        );
      }

      progress.step = "delete";
      continue;
    }

    try {
      await request(call, {
        method: "DELETE",
        path: diskPath,
        step: "disk delete",
      });
    } catch (error) {
      if (isNotFound(error)) {
        return done({
          progress,
          changed: false,
          summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
        });
      }

      if (isInUse(error)) {
        throw new BadDataException(
          `${capitalized(call.what)} was attached before it could be deleted, so it was kept: ${googleErrorOf(error).message}`,
        );
      }

      throw explain(error, { what: call.what, permission: DISK_DELETE });
    }

    return done({
      progress,
      changed: true,
      summary: progress.snapshotId
        ? `Deleted ${call.what}, after a final snapshot (${progress.snapshotId}) it can be made again from.`
        : `Deleted ${call.what}. No final snapshot was taken.`,
    });
  }
}

// A deleted disk made again from its final snapshot, as it was.
async function restoreDisk(
  call: GcpCall,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  const snapshot: string = run.applied.snapshotId || "";
  const disk: JSONObject = readObject(run.applied.disk);

  if (!snapshot) {
    throw new BadDataException(
      "No final snapshot was taken before this disk was deleted, so it cannot be made again.",
    );
  }

  if (run.progress.restoredId) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already made again from its final snapshot.`,
    });
  }

  const place: Array<string> = placeOf(call);
  const type: string = readText(disk["type"]);
  const sizeGb: number = Number(disk["sizeGb"]) || 0;
  const replicaZones: Array<string> = readArray(disk["replicaZones"]).map(
    (zone: unknown): string => {
      return String(zone);
    },
  );

  try {
    await request(call, {
      method: "POST",
      path: pathOf(call, ...place, "disks"),
      body: {
        name: call.target.id,
        sourceSnapshot: `global/snapshots/${snapshot}`,
        ...(type ? { type: `${place.join("/")}/diskTypes/${type}` } : {}),
        ...(sizeGb > 0 ? { sizeGb: String(sizeGb) } : {}),
        ...(replicaZones.length > 0 ? { replicaZones } : {}),
        labels: {
          ...readObject(disk["labels"]),
          [CLOUD_SAVINGS_ACTION_TAG_KEY]: labelValueOf(run.actionId),
        },
      },
      step: "disk restore",
    });
  } catch (error) {
    // Made before, its answer lost - or a disk of its name made since.
    if (isAlreadyThere(error)) {
      return done({
        progress: { ...run.progress, restoredId: call.target.id },
        changed: false,
        summary: `A disk named ${call.target.id} is there again already; nothing changed.`,
      });
    }

    throw explain(error, { what: call.what, permission: DISK_CREATE });
  }

  return done({
    progress: { ...run.progress, restoredId: call.target.id },
    changed: true,
    summary: `Made ${call.what} again from its final snapshot ${snapshot}, in ${call.target.location}. Attach it where it was used.`,
  });
}

async function releaseAddress(
  call: GcpCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const isGlobal: boolean = call.target.gcpScope === "global";
  const path: string = pathOf(
    call,
    ...placeOf(call),
    "addresses",
    call.target.id,
  );
  let address: JSONObject;

  try {
    address = await request(call, {
      method: "GET",
      path,
      step: "address request",
    });
  } catch (error) {
    if (isNotFound(error)) {
      return done({
        progress: run.progress,
        changed: false,
        summary: `${capitalized(call.what)} was already released; nothing changed.`,
      });
    }

    throw explain(error, {
      what: call.what,
      permission: isGlobal ? GLOBAL_ADDRESS_GET : ADDRESS_GET,
    });
  }

  const ip: string = readText(address["address"]);
  const named: string = ip ? `${call.what} (${ip})` : call.what;
  const users: Array<string> = readArray(address["users"]).map(
    (user: unknown): string => {
      return String(user);
    },
  );

  if (readText(address["status"]) === "IN_USE" || users.length > 0) {
    throw new BadDataException(
      `${capitalized(named)} is used by ${
        users[0] ? lastPartOf(users[0]) : "a resource"
      } now, so it was not released.`,
    );
  }

  try {
    await request(call, { method: "DELETE", path, step: "address release" });
  } catch (error) {
    if (isNotFound(error)) {
      return done({
        progress: run.progress,
        changed: false,
        summary: `${capitalized(call.what)} was already released; nothing changed.`,
      });
    }

    if (isInUse(error)) {
      throw new BadDataException(
        `${capitalized(named)} was put to use before it could be released, so it was kept: ${googleErrorOf(error).message}`,
      );
    }

    throw explain(error, {
      what: call.what,
      permission: isGlobal ? GLOBAL_ADDRESS_DELETE : ADDRESS_DELETE,
    });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Released ${named}: it goes back to Google Cloud and cannot be had again.`,
  });
}

async function deleteImage(
  call: GcpCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const path: string = pathOf(call, "global", "images", call.target.id);

  try {
    await request(call, { method: "GET", path, step: "image request" });
  } catch (error) {
    if (isNotFound(error)) {
      return done({
        progress: run.progress,
        changed: false,
        summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
      });
    }

    throw explain(error, { what: call.what, permission: IMAGE_GET });
  }

  try {
    await request(call, { method: "DELETE", path, step: "image delete" });
  } catch (error) {
    throw explain(error, { what: call.what, permission: IMAGE_DELETE });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Deleted ${call.what}.`,
  });
}

/*
 * ---------------------------------------------------------------------------
 * The change, and its undo
 * ---------------------------------------------------------------------------
 */

function needs(value: string | undefined, what: string): string {
  if (!value) {
    throw new BadDataException(`The change does not say ${what}.`);
  }

  return value;
}

function notMade(kind: CloudSavingsActionKind): BadDataException {
  return new BadDataException(
    `OneUptime does not make a change of this kind in Google Cloud: ${kind}.`,
  );
}

export async function applyGcpSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance: {
      const call: GcpCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Instance, run.kind);
      return await stopInstance(call, run);
    }
    case CloudSavingsActionKind.DeleteVolume: {
      const call: GcpCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Volume, run.kind);
      return await deleteDisk(call, run);
    }
    case CloudSavingsActionKind.ReleaseAddress: {
      const call: GcpCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Address, run.kind);
      return await releaseAddress(call, run);
    }
    case CloudSavingsActionKind.DeleteImage: {
      const call: GcpCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Image, run.kind);
      return await deleteImage(call, run);
    }
    case CloudSavingsActionKind.ResizeInstance: {
      const to: string = needs(run.to, "which machine type to resize to");
      const call: GcpCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Instance, run.kind);
      return await resizeInstance(call, run, to);
    }
    default:
      throw notMade(run.kind);
  }
}

/*
 * Takes a change back: starts an instance that was stopped, sizes back one
 * that was resized, makes a deleted disk again from its final snapshot.
 * What cannot be undone says why. Its steps are its own (run.progress);
 * what the change did is run.applied.
 */
export async function undoGcpSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance:
      return await startInstance(open(context, run.target), run);
    case CloudSavingsActionKind.DeleteVolume:
      return await restoreDisk(open(context, run.target), run);
    case CloudSavingsActionKind.ResizeInstance: {
      const previous: string = needs(
        run.applied.previous,
        "what the instance's machine type was",
      );
      return await resizeInstance(open(context, run.target), run, previous);
    }
    case CloudSavingsActionKind.ReleaseAddress:
    case CloudSavingsActionKind.DeleteImage:
      throw new BadDataException(
        "This change cannot be undone: what it deleted or released is gone.",
      );
    default:
      throw notMade(run.kind);
  }
}
