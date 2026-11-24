import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
  CloudSavingsTargetType,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { CLOUD_SAVINGS_ACTION_TAG_KEY } from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import AzureArm from "../../CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  explainExpiredAzureSecret,
} from "../../CloudConnection/Azure/AzureCloudConnector";
import {
  CloudConnectionSettings,
  CloudReadBudget,
  readCloudSetting,
} from "../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import AzureMonitorClient from "../../LlmObservability/Connectors/AzureOpenAI/AzureMonitorClient";
import EntraTokenClient from "../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  buildQueryString,
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
 * ACTING ON A SAVING IN AZURE (#11010), through the connection's opt-in
 * custom role, OneUptime Savings Actions (CloudSavingsActionsAccess).
 *
 *   StopInstance     GET the VM with its instance view, then POST
 *                    deallocate - the one stop Azure stops billing a VM's
 *                    compute for (a VM stopped from inside is still
 *                    billed); undone with POST start.
 *   DeleteVolume     GET the managed disk (unattached only), PUT a final
 *                    snapshot of it (incremental, which costs what the
 *                    disk holds, not its size) and GET it until it has
 *                    succeeded, then DELETE the disk; undone by a PUT of
 *                    the disk again, of its name, location, zones, SKU and
 *                    tags, copied from that snapshot.
 *   DeleteSnapshot   GET, then DELETE. Never undone.
 *   ReleaseAddress   GET the public IP (associated with nothing only),
 *                    then DELETE it. Never undone: its address goes back
 *                    to Azure.
 *   ResizeInstance   GET the VM's size, then PATCH hardwareProfile.vmSize:
 *                    Azure restarts the VM to resize it. Undone the same
 *                    way back.
 *
 *     GET    {arm}{id}?api-version=2024-03-01&$expand=instanceView   a VM
 *     POST   {arm}{id}/deallocate | /start ?api-version=2024-03-01
 *     PATCH  {arm}{id}?api-version=2024-03-01
 *            { properties: { hardwareProfile: { vmSize } } }
 *     GET/PUT/DELETE {arm}{disk or snapshot id}?api-version=2023-04-02
 *     GET/DELETE {arm}{public IP id}?api-version=2023-09-01
 *
 * Every step reads before it writes, so run twice it does no more than
 * once; a PATCH names the one setting it changes, never the VM whole. A
 * refusal says which permission the role lacks and which setting grants
 * it; a lock says so, in Azure's words; a connection that names its
 * subscriptions changes nothing outside them.
 */

const COMPUTE_API_VERSION: string = "2024-03-01";
const DISK_API_VERSION: string = "2023-04-02";
const NETWORK_API_VERSION: string = "2023-09-01";
const DEFAULT_MAX_REQUESTS: number = 20;
const DEFAULT_MAX_DURATION_MS: number = 2 * 60 * 1000;

// The SKU a final snapshot is kept on: standard HDD, the cheapest.
const SNAPSHOT_SKU: string = "Standard_LRS";

// The permission each call needs, named in a refusal - each one Savings actions grants.
const VM_READ: string = "Microsoft.Compute/virtualMachines/read";
const VM_DEALLOCATE: string =
  "Microsoft.Compute/virtualMachines/deallocate/action";
const VM_START: string = "Microsoft.Compute/virtualMachines/start/action";
const VM_WRITE: string = "Microsoft.Compute/virtualMachines/write";
const DISK_READ: string = "Microsoft.Compute/disks/read";
const DISK_WRITE: string = "Microsoft.Compute/disks/write";
const DISK_DELETE: string = "Microsoft.Compute/disks/delete";
const SNAPSHOT_READ: string = "Microsoft.Compute/snapshots/read";
const SNAPSHOT_WRITE: string = "Microsoft.Compute/snapshots/write";
const SNAPSHOT_DELETE: string = "Microsoft.Compute/snapshots/delete";
const PUBLIC_IP_READ: string = "Microsoft.Network/publicIPAddresses/read";
const PUBLIC_IP_DELETE: string = "Microsoft.Network/publicIPAddresses/delete";

// The one permission only the resize choice grants.
const RESIZE_PERMISSIONS: ReadonlyArray<string> = [VM_WRITE];

interface AzureCall {
  arm: AzureArm;
  target: CloudSavingsTarget;
  armId: string;
  // What the resource is called in a sentence: "VM web-01", "disk old-data".
  what: string;
}

function describeTarget(target: CloudSavingsTarget): string {
  switch (target.type) {
    case CloudSavingsTargetType.Instance:
      return `VM ${target.id}`;
    case CloudSavingsTargetType.Volume:
      return `disk ${target.id}`;
    case CloudSavingsTargetType.Snapshot:
      return `snapshot ${target.id}`;
    case CloudSavingsTargetType.Address:
      return `public IP ${target.id}`;
    default:
      return target.id;
  }
}

// A sentence's first word in capitals: "disk x was not found" -> "Disk x ...".
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * The resource a change is made to, in a subscription the connection
 * reads, and the Resource Manager client signed in as its app - as Data
 * Security's response actions open a storage account.
 */
function open(
  context: CloudSavingsStepContext,
  target: CloudSavingsTarget,
): AzureCall {
  const connector: AzureCloudConnector = new AzureCloudConnector();
  const settings: CloudConnectionSettings = context.settings;

  connector.validateSettings(settings);

  const armId: string = (target.armId || "").trim();

  if (target.provider !== CloudProvider.Azure || !armId) {
    throw new BadDataException(
      `${capitalized(describeTarget(target))} is not an Azure resource OneUptime can change.`,
    );
  }

  AzureMonitorClient.assertResourceId(armId);

  const named: Array<string> = connector.getSubscriptionIds(settings);

  // A connection that names its subscriptions changes nothing outside them.
  if (
    named.length > 0 &&
    !named.some((subscriptionId: string): boolean => {
      return subscriptionId.toLowerCase() === target.account.toLowerCase();
    })
  ) {
    throw new BadDataException(
      `${capitalized(describeTarget(target))} is in subscription ${target.account}, which this connection does not read.`,
    );
  }

  const arm: AzureArm = new AzureArm({
    tenantId: readCloudSetting(settings.config, "tenantId"),
    clientId: readCloudSetting(settings.config, "clientId"),
    clientSecret: readCloudSetting(settings.secrets, "clientSecret"),
    cloud: EntraTokenClient.resolveCloud(
      readCloudSetting(settings.config, "cloud") || "public",
    ),
    transport:
      context.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
    budget:
      context.budget ||
      new CloudReadBudget({
        maxRequests: DEFAULT_MAX_REQUESTS,
        maxDurationMs: DEFAULT_MAX_DURATION_MS,
      }),
    sleep: context.sleep,
  });

  return { arm, target, armId, what: describeTarget(target) };
}

// A URL under the management host: a resource, or an action of it, with its api-version.
function urlOf(call: AzureCall, path: string, apiVersion: string): string {
  return `${call.arm.getManagementBaseUrl()}${path}?${buildQueryString([
    ["api-version", apiVersion],
  ])}`;
}

// What Azure said of a failure, in its own words.
function armErrorOf(error: unknown): { message: string } {
  if (error instanceof LlmProviderError) {
    try {
      const body: JSONObject = readObject(
        JSON.parse(error.responseBody || "{}"),
      );
      const message: string = readText(readObject(body["error"])["message"]);

      if (message) {
        return { message };
      }
    } catch {
      // Not JSON: the error's own message says it.
    }

    return { message: error.message };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}

// Whether Azure answered that the resource is not there.
function isNotFound(error: unknown): boolean {
  return error instanceof LlmProviderError && error.statusCode === 404;
}

/*
 * Whether Azure refused because a lock holds the resource (ScopeLocked).
 * Read from Azure's words - "...because following scope(s) are locked" -
 * as well as its code: an error's "code" member is masked when an error
 * is kept, as an OAuth code would be (LogRedaction), so it cannot be
 * relied on alone.
 */
const LOCKED_WORDS: RegExp = /scopelocked|scope\(s\) are locked|is locked/i;

function isLocked(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.statusCode === 409 &&
    LOCKED_WORDS.test(`${error.responseBody || ""} ${error.message}`)
  );
}

/*
 * A refusal, said with the permission the role lacks and the setting that
 * grants it; an expired secret, a resource that is gone and a lock, as
 * what they are; anything else as Azure said it.
 */
function explain(
  error: unknown,
  data: { what: string; permission: string },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Authentication) {
    return explainExpiredAzureSecret(error);
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    return new LlmProviderError({
      message: `Azure refused ${data.permission} on ${data.what}: the app may not do it. Set the connection's Savings actions to ${
        RESIZE_PERMISSIONS.includes(data.permission)
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
      message: `${capitalized(data.what)} was not found: it may have been deleted or moved.`,
      kind: CloudConnectionFailureKind.Settings,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  if (error.statusCode === 409) {
    return new LlmProviderError({
      message: `Azure would not change ${data.what} now - a lock on it, or an operation in progress: ${armErrorOf(error).message}`,
      kind: CloudConnectionFailureKind.Other,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

function expectType(
  call: AzureCall,
  type: CloudSavingsTargetType,
  kind: CloudSavingsActionKind,
): void {
  if (call.target.type !== type) {
    throw new BadDataException(
      `OneUptime does not make a change of this kind to ${call.what}: ${kind}.`,
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * VMs
 * ---------------------------------------------------------------------------
 */

interface AzureVm {
  // Its power state, as its instance view's PowerState/... code says: "running", "deallocated"...
  powerState: string;
  vmSize: string;
}

async function readVm(call: AzureCall): Promise<AzureVm | null> {
  let vm: JSONObject;

  try {
    vm = await call.arm.getJson(
      // The instance view, which holds the power state, as Azure's docs write it.
      `${urlOf(call, call.armId, COMPUTE_API_VERSION)}&$expand=instanceView`,
      "VM request",
    );
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw explain(error, { what: call.what, permission: VM_READ });
  }

  const properties: JSONObject = readObject(vm["properties"]);
  let powerState: string = "";

  for (const status of readArray(
    readObject(properties["instanceView"])["statuses"],
  )) {
    const code: string = readText(readObject(status)["code"]);

    if (code.toLowerCase().startsWith("powerstate/")) {
      powerState = code.slice("powerstate/".length).toLowerCase();
      break;
    }
  }

  return {
    powerState,
    vmSize: readText(readObject(properties["hardwareProfile"])["vmSize"]),
  };
}

function vmGone(call: AzureCall): BadDataException {
  return new BadDataException(
    `${capitalized(call.what)} was not found: it may have been deleted.`,
  );
}

async function vmAction(
  call: AzureCall,
  action: "deallocate" | "start",
): Promise<void> {
  try {
    await call.arm.action(
      urlOf(call, `${call.armId}/${action}`, COMPUTE_API_VERSION),
      action === "deallocate" ? "VM deallocate" : "VM start",
    );
  } catch (error) {
    throw explain(error, {
      what: call.what,
      permission: action === "deallocate" ? VM_DEALLOCATE : VM_START,
    });
  }
}

async function stopVm(
  call: AzureCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const vm: AzureVm | null = await readVm(call);

  if (!vm) {
    throw vmGone(call);
  }

  if (vm.powerState === "deallocated" || vm.powerState === "deallocating") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already deallocated; nothing changed.`,
    });
  }

  await vmAction(call, "deallocate");

  return done({
    progress: run.progress,
    changed: true,
    summary:
      vm.powerState === "stopped"
        ? `Deallocated ${call.what}: it was stopped but still allocated, which Azure still bills. Its disks are kept, and it can be started again.`
        : `Deallocated ${call.what}, so Azure no longer bills its compute. Its disks are kept, and it can be started again.`,
  });
}

async function startVm(
  call: AzureCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const vm: AzureVm | null = await readVm(call);

  if (!vm) {
    throw vmGone(call);
  }

  if (vm.powerState === "running" || vm.powerState === "starting") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already running; nothing changed.`,
    });
  }

  // A deallocate still under way: Azure refuses a start until it is done.
  if (vm.powerState === "deallocating" || vm.powerState === "stopping") {
    return waiting(run.progress, `Waiting for ${call.what} to deallocate.`);
  }

  await vmAction(call, "start");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Started ${call.what} again.`,
  });
}

/*
 * A resize: the one setting, PATCHed. Azure restarts the VM to make it -
 * or answers that the size cannot be had where the VM runs, which is said
 * in Azure's words, the VM left as it was.
 */
async function resizeVm(
  call: AzureCall,
  run: CloudSavingsRun,
  to: string,
): Promise<CloudSavingsStepOutcome> {
  const vm: AzureVm | null = await readVm(call);

  if (!vm) {
    throw vmGone(call);
  }

  if (vm.vmSize.toLowerCase() === to.toLowerCase()) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `${capitalized(call.what)} was already ${to}; nothing changed.`,
    });
  }

  try {
    await call.arm.patch(
      urlOf(call, call.armId, COMPUTE_API_VERSION),
      { properties: { hardwareProfile: { vmSize: to } } },
      "VM size update",
    );
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      error.kind !== CloudConnectionFailureKind.Permission &&
      error.kind !== CloudConnectionFailureKind.Authentication &&
      !isLocked(error) &&
      (error.statusCode === 400 || error.statusCode === 409)
    ) {
      throw new BadDataException(
        `Azure would not make ${call.what} a ${to}, so it was left a ${vm.vmSize || "the size it was"}: ${armErrorOf(error).message}`,
      );
    }

    throw explain(error, { what: call.what, permission: VM_WRITE });
  }

  return done({
    progress: { ...run.progress, previous: vm.vmSize },
    changed: true,
    summary: `Resized ${call.what} from ${vm.vmSize} to ${to}. Azure restarts it to do so.`,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Disks, snapshots and public IPs
 * ---------------------------------------------------------------------------
 */

// The ARM id of a snapshot in the same resource group as the disk it is of.
function snapshotIdOf(call: AzureCall, name: string): string {
  return `/subscriptions/${call.target.account}/resourceGroups/${
    call.target.resourceGroup || ""
  }/providers/Microsoft.Compute/snapshots/${name}`;
}

// The name at the end of an ARM id.
function nameOf(armId: string): string {
  return armId.slice(armId.lastIndexOf("/") + 1);
}

/*
 * An unattached disk deleted, in its steps: read it (still unattached),
 * its final snapshot made and waited for, then the delete. What it was is
 * kept, to make it again from the snapshot.
 */
async function deleteDisk(
  call: AzureCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  let progress: CloudSavingsProgress = { ...run.progress };

  for (;;) {
    const step: string = progress.step || "start";

    if (step === "start") {
      let disk: JSONObject;

      try {
        disk = await call.arm.getJson(
          urlOf(call, call.armId, DISK_API_VERSION),
          "disk request",
        );
      } catch (error) {
        if (isNotFound(error)) {
          return done({
            progress,
            changed: false,
            summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
          });
        }

        throw explain(error, { what: call.what, permission: DISK_READ });
      }

      const properties: JSONObject = readObject(disk["properties"]);
      const managedBy: string = readText(disk["managedBy"]);
      const state: string = readText(properties["diskState"]);

      if (managedBy) {
        throw new BadDataException(
          `${capitalized(call.what)} is attached to ${nameOf(managedBy)} now, so it was not deleted.`,
        );
      }

      if (state && state !== "Unattached") {
        throw new BadDataException(
          `${capitalized(call.what)} is ${state} now, so it was not deleted.`,
        );
      }

      progress = {
        ...progress,
        disk: {
          location: readText(disk["location"]),
          skuName: readText(readObject(disk["sku"])["name"]),
          zones: readArray(disk["zones"]).map((zone: unknown): string => {
            return String(zone);
          }),
          tags: readObject(disk["tags"]),
          diskSizeGB: Number(properties["diskSizeGB"]) || 0,
        },
        step: run.finalSnapshot ? "snapshot" : "delete",
      };
      continue;
    }

    if (step === "snapshot") {
      const name: string = getFinalSnapshotName(call.target.id, run.actionId);
      const snapshotId: string = snapshotIdOf(call, name);
      const disk: JSONObject = readObject(progress.disk);

      try {
        await call.arm.put(
          urlOf(call, snapshotId, DISK_API_VERSION),
          {
            location: readText(disk["location"]),
            sku: { name: SNAPSHOT_SKU },
            tags: { [CLOUD_SAVINGS_ACTION_TAG_KEY]: run.actionId },
            properties: {
              creationData: {
                createOption: "Copy",
                sourceResourceId: call.armId,
              },
              // The first incremental snapshot of a disk holds all of it, for what it holds.
              incremental: true,
            },
          },
          "final snapshot",
        );
      } catch (error) {
        throw explain(error, { what: call.what, permission: SNAPSHOT_WRITE });
      }

      progress = { ...progress, snapshotId, step: "wait-snapshot" };
      return waiting(
        progress,
        `Taking a final snapshot of ${call.what} (${name}) before deleting it.`,
      );
    }

    if (step === "wait-snapshot") {
      const snapshotId: string = progress.snapshotId || "";
      let state: string = "";

      try {
        state = readText(
          readObject(
            (
              await call.arm.getJson(
                urlOf(call, snapshotId, DISK_API_VERSION),
                "final snapshot request",
              )
            )["properties"],
          )["provisioningState"],
        );
      } catch (error) {
        if (!isNotFound(error)) {
          throw explain(error, {
            what: `snapshot ${nameOf(snapshotId)}`,
            permission: SNAPSHOT_READ,
          });
        }

        state = "Failed";
      }

      if (state === "Failed" || state === "Canceled") {
        throw new BadDataException(
          `The final snapshot of ${call.what} failed, so the disk was not deleted.`,
        );
      }

      if (state !== "Succeeded") {
        return waiting(
          progress,
          `Waiting for the final snapshot of ${call.what} (${nameOf(snapshotId)}) to complete.`,
        );
      }

      progress.step = "delete";
      continue;
    }

    try {
      await call.arm.delete(
        urlOf(call, call.armId, DISK_API_VERSION),
        "disk delete",
      );
    } catch (error) {
      if (isNotFound(error)) {
        return done({
          progress,
          changed: false,
          summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
        });
      }

      if (
        error instanceof LlmProviderError &&
        error.statusCode === 409 &&
        !isLocked(error)
      ) {
        throw new BadDataException(
          `${capitalized(call.what)} was attached before it could be deleted, so it was kept: ${armErrorOf(error).message}`,
        );
      }

      throw explain(error, { what: call.what, permission: DISK_DELETE });
    }

    return done({
      progress,
      changed: true,
      summary: progress.snapshotId
        ? `Deleted ${call.what}, after a final snapshot (${nameOf(progress.snapshotId)}) it can be made again from.`
        : `Deleted ${call.what}. No final snapshot was taken.`,
    });
  }
}

// A deleted disk made again from its final snapshot, as it was.
async function restoreDisk(
  call: AzureCall,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  const snapshotId: string = run.applied.snapshotId || "";
  const disk: JSONObject = readObject(run.applied.disk);

  if (!snapshotId) {
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

  const zones: Array<string> = readArray(disk["zones"]).map(
    (zone: unknown): string => {
      return String(zone);
    },
  );
  const skuName: string = readText(disk["skuName"]);

  try {
    // A PUT of the same disk sent again makes the same disk: its name is its key.
    await call.arm.put(
      urlOf(call, call.armId, DISK_API_VERSION),
      {
        location: readText(disk["location"]),
        ...(skuName ? { sku: { name: skuName } } : {}),
        ...(zones.length > 0 ? { zones } : {}),
        tags: {
          ...readObject(disk["tags"]),
          [CLOUD_SAVINGS_ACTION_TAG_KEY]: run.actionId,
        },
        properties: {
          creationData: { createOption: "Copy", sourceResourceId: snapshotId },
        },
      },
      "disk restore",
    );
  } catch (error) {
    throw explain(error, { what: call.what, permission: DISK_WRITE });
  }

  return done({
    progress: { ...run.progress, restoredId: call.armId },
    changed: true,
    summary: `Made ${call.what} again from its final snapshot ${nameOf(snapshotId)}, in ${
      readText(disk["location"]) || "its location"
    }. Attach it where it was used.`,
  });
}

async function deleteSnapshot(
  call: AzureCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  try {
    await call.arm.getJson(
      urlOf(call, call.armId, DISK_API_VERSION),
      "snapshot request",
    );
  } catch (error) {
    if (isNotFound(error)) {
      return done({
        progress: run.progress,
        changed: false,
        summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
      });
    }

    throw explain(error, { what: call.what, permission: SNAPSHOT_READ });
  }

  try {
    await call.arm.delete(
      urlOf(call, call.armId, DISK_API_VERSION),
      "snapshot delete",
    );
  } catch (error) {
    throw explain(error, { what: call.what, permission: SNAPSHOT_DELETE });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Deleted ${call.what}.`,
  });
}

async function releasePublicIp(
  call: AzureCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  let address: JSONObject;

  try {
    address = await call.arm.getJson(
      urlOf(call, call.armId, NETWORK_API_VERSION),
      "public IP request",
    );
  } catch (error) {
    if (isNotFound(error)) {
      return done({
        progress: run.progress,
        changed: false,
        summary: `${capitalized(call.what)} was already deleted; nothing changed.`,
      });
    }

    throw explain(error, { what: call.what, permission: PUBLIC_IP_READ });
  }

  const properties: JSONObject = readObject(address["properties"]);
  const ip: string = readText(properties["ipAddress"]);
  const named: string = ip ? `${call.what} (${ip})` : call.what;
  const user: string =
    readText(readObject(properties["ipConfiguration"])["id"]) ||
    readText(readObject(properties["natGateway"])["id"]);

  if (user) {
    // ".../networkInterfaces/web-nic/ipConfigurations/ipconfig1": what holds it.
    const parts: Array<string> = user.split("/");
    const holder: string =
      parts.length >= 3 && parts[parts.length - 2] === "ipConfigurations"
        ? parts[parts.length - 3]!
        : nameOf(user);

    throw new BadDataException(
      `${capitalized(named)} is associated with ${holder} now, so it was not released.`,
    );
  }

  try {
    await call.arm.delete(
      urlOf(call, call.armId, NETWORK_API_VERSION),
      "public IP delete",
    );
  } catch (error) {
    throw explain(error, { what: call.what, permission: PUBLIC_IP_DELETE });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Released ${named}: its address goes back to Azure and cannot be had again.`,
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
    `OneUptime does not make a change of this kind in Azure: ${kind}.`,
  );
}

export async function applyAzureSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance: {
      const call: AzureCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Instance, run.kind);
      return await stopVm(call, run);
    }
    case CloudSavingsActionKind.DeleteVolume: {
      const call: AzureCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Volume, run.kind);
      return await deleteDisk(call, run);
    }
    case CloudSavingsActionKind.DeleteSnapshot: {
      const call: AzureCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Snapshot, run.kind);
      return await deleteSnapshot(call, run);
    }
    case CloudSavingsActionKind.ReleaseAddress: {
      const call: AzureCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Address, run.kind);
      return await releasePublicIp(call, run);
    }
    case CloudSavingsActionKind.ResizeInstance: {
      const to: string = needs(run.to, "which size to resize to");
      const call: AzureCall = open(context, run.target);
      expectType(call, CloudSavingsTargetType.Instance, run.kind);
      return await resizeVm(call, run, to);
    }
    default:
      throw notMade(run.kind);
  }
}

/*
 * Takes a change back: starts a VM that was deallocated, sizes back one
 * that was resized, makes a deleted disk again from its final snapshot.
 * What cannot be undone says why. Its steps are its own (run.progress);
 * what the change did is run.applied.
 */
export async function undoAzureSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance:
      return await startVm(open(context, run.target), run);
    case CloudSavingsActionKind.DeleteVolume:
      return await restoreDisk(open(context, run.target), run);
    case CloudSavingsActionKind.ResizeInstance: {
      const previous: string = needs(
        run.applied.previous,
        "what the VM's size was",
      );
      return await resizeVm(open(context, run.target), run, previous);
    }
    case CloudSavingsActionKind.DeleteSnapshot:
    case CloudSavingsActionKind.ReleaseAddress:
      throw new BadDataException(
        "This change cannot be undone: what it deleted or released is gone.",
      );
    default:
      throw notMade(run.kind);
  }
}
