import { translationKey } from "../Translator";
import { CloudSavingKind } from "./CloudCost";
import { CloudProvider } from "./CloudPlatform";

/*
 * ACTING ON A WAY TO SPEND LESS (#11010): WHAT ONEUPTIME CAN CHANGE IN A
 * CLOUD FOR A SAVING, AND HOW IT IS TAKEN BACK.
 *
 * A saving OneUptime reads (CloudCostRecommendation) is one change a
 * person would otherwise make in the cloud's console. Where that change is
 * one the cloud's API makes in one step - stop an idle instance, delete an
 * unattached disk, release an idle address, move a volume from gp2 to gp3,
 * resize an instance or a database to the size recommended - OneUptime
 * can make it through the account's cloud connection, once a person who
 * may approve it says yes, or on its own where an AI rule allows it
 * (CloudSavingsAi). This module is the one reading of which saving is
 * which change, for the server that makes it and the Dashboard that offers
 * it alike: pure, so both import it.
 *
 * Which changes, and why these (the issue's first decision):
 *
 *   - Stop an idle instance or database (StopInstance, StopDatabase): one
 *     press starts it again, nothing is lost. A database AWS stopped is
 *     started again by AWS after seven days.
 *   - Change a volume's type, gp2 to gp3 (ChangeVolumeType): no downtime,
 *     and gp3 is cheaper for the same size; changed back the same way.
 *   - Delete an unattached disk (DeleteVolume), after a final snapshot
 *     unless the person unticks it: the disk can be made again from the
 *     snapshot, which costs a fraction of the disk.
 *   - Delete an old snapshot or image (DeleteSnapshot, DeleteImage), and
 *     release an idle public address (ReleaseAddress): near free to
 *     recreate but never undone - a released address goes back to the
 *     cloud's pool - so a person always approves them.
 *   - Resize an instance or a database (ResizeInstance, ResizeDatabase):
 *     a restart, so it comes second, on a choice of its own in the
 *     connection (CloudSavingsActionsAccess.Resize). A move to an Arm
 *     (Graviton) size needs an image built for Arm, so it is not made in
 *     place.
 *
 * Buying a commitment (a Savings Plan, a reservation) is never made by
 * OneUptime: its saving links to the cloud's own purchase page.
 */

/*
 * What OneUptime changes. Stored on every action (CloudSavingsAction) and
 * sent by the API: a wire contract, never rename one.
 */
export enum CloudSavingsActionKind {
  StopInstance = "StopInstance",
  StopDatabase = "StopDatabase",
  ChangeVolumeType = "ChangeVolumeType",
  DeleteVolume = "DeleteVolume",
  DeleteSnapshot = "DeleteSnapshot",
  DeleteImage = "DeleteImage",
  ReleaseAddress = "ReleaseAddress",
  ResizeInstance = "ResizeInstance",
  ResizeDatabase = "ResizeDatabase",
}

export const CLOUD_SAVINGS_ACTION_KINDS: ReadonlyArray<CloudSavingsActionKind> =
  [
    CloudSavingsActionKind.StopInstance,
    CloudSavingsActionKind.StopDatabase,
    CloudSavingsActionKind.ChangeVolumeType,
    CloudSavingsActionKind.DeleteVolume,
    CloudSavingsActionKind.DeleteSnapshot,
    CloudSavingsActionKind.DeleteImage,
    CloudSavingsActionKind.ReleaseAddress,
    CloudSavingsActionKind.ResizeInstance,
    CloudSavingsActionKind.ResizeDatabase,
  ];

export function isCloudSavingsActionKind(
  value: unknown,
): value is CloudSavingsActionKind {
  return (
    typeof value === "string" &&
    (CLOUD_SAVINGS_ACTION_KINDS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * How far a connection lets OneUptime act on savings, as its setup command
 * granted it (CloudConnectionCatalog's "Savings actions"): nothing (every
 * connection until someone picks otherwise), stopping, starting and
 * cleaning up, or that and resizing - a restart - too.
 */
export enum CloudSavingsActionsAccess {
  Off = "off",
  CleanUp = "clean-up",
  Resize = "resize",
}

export const CLOUD_SAVINGS_ACTIONS_ACCESS_LEVELS: ReadonlyArray<CloudSavingsActionsAccess> =
  [
    CloudSavingsActionsAccess.Off,
    CloudSavingsActionsAccess.CleanUp,
    CloudSavingsActionsAccess.Resize,
  ];

// A connection's choice: its setting when it is one of the levels, else off.
export function getCloudSavingsActionsAccess(
  value: unknown,
): CloudSavingsActionsAccess {
  return (
    CLOUD_SAVINGS_ACTIONS_ACCESS_LEVELS.find(
      (level: CloudSavingsActionsAccess): boolean => {
        return level === value;
      },
    ) || CloudSavingsActionsAccess.Off
  );
}

// The changes that restart what they change: granted only by "resize".
export const CLOUD_SAVINGS_RESIZE_KINDS: ReadonlyArray<CloudSavingsActionKind> =
  [
    CloudSavingsActionKind.ResizeInstance,
    CloudSavingsActionKind.ResizeDatabase,
  ];

// Whether a connection's choice lets OneUptime make a change of this kind.
export function isCloudSavingsActionAllowed(
  access: CloudSavingsActionsAccess,
  kind: CloudSavingsActionKind,
): boolean {
  if (access === CloudSavingsActionsAccess.Off) {
    return false;
  }

  if (CLOUD_SAVINGS_RESIZE_KINDS.includes(kind)) {
    return access === CloudSavingsActionsAccess.Resize;
  }

  return true;
}

/*
 * The changes each cloud makes. Azure stops a VM by deallocating it (the
 * one stop Azure stops billing for); Google Cloud's images are its old
 * snapshots' kind of leftover. A database is stopped and resized on AWS
 * only: Azure SQL and Cloud SQL are scaled in their own consoles.
 */
export const CLOUD_SAVINGS_ACTION_KINDS_BY_PROVIDER: Readonly<
  Record<CloudProvider, ReadonlyArray<CloudSavingsActionKind>>
> = {
  [CloudProvider.AWS]: [
    CloudSavingsActionKind.StopInstance,
    CloudSavingsActionKind.StopDatabase,
    CloudSavingsActionKind.ChangeVolumeType,
    CloudSavingsActionKind.DeleteVolume,
    CloudSavingsActionKind.DeleteSnapshot,
    CloudSavingsActionKind.ReleaseAddress,
    CloudSavingsActionKind.ResizeInstance,
    CloudSavingsActionKind.ResizeDatabase,
  ],
  [CloudProvider.Azure]: [
    CloudSavingsActionKind.StopInstance,
    CloudSavingsActionKind.DeleteVolume,
    CloudSavingsActionKind.DeleteSnapshot,
    CloudSavingsActionKind.ReleaseAddress,
    CloudSavingsActionKind.ResizeInstance,
  ],
  [CloudProvider.GCP]: [
    CloudSavingsActionKind.StopInstance,
    CloudSavingsActionKind.DeleteVolume,
    CloudSavingsActionKind.DeleteImage,
    CloudSavingsActionKind.ReleaseAddress,
    CloudSavingsActionKind.ResizeInstance,
  ],
};

/*
 * Whether a change can be taken back, and how. Stored on each action: a
 * wire contract.
 */
export enum CloudSavingsActionUndo {
  // One press puts it back: started again, sized back, typed back.
  Undoable = "Undoable",
  // Made again from the final snapshot taken before it was deleted.
  FromSnapshot = "FromSnapshot",
  // Gone for good: a released address, a deleted snapshot or image.
  Never = "Never",
}

/*
 * How each kind is taken back. A deleted volume is made again from its
 * final snapshot when one was taken (getCloudSavingsActionUndo).
 */
export const CLOUD_SAVINGS_ACTION_UNDO: Readonly<
  Record<CloudSavingsActionKind, CloudSavingsActionUndo>
> = {
  [CloudSavingsActionKind.StopInstance]: CloudSavingsActionUndo.Undoable,
  [CloudSavingsActionKind.StopDatabase]: CloudSavingsActionUndo.Undoable,
  [CloudSavingsActionKind.ChangeVolumeType]: CloudSavingsActionUndo.Undoable,
  [CloudSavingsActionKind.DeleteVolume]: CloudSavingsActionUndo.FromSnapshot,
  [CloudSavingsActionKind.DeleteSnapshot]: CloudSavingsActionUndo.Never,
  [CloudSavingsActionKind.DeleteImage]: CloudSavingsActionUndo.Never,
  [CloudSavingsActionKind.ReleaseAddress]: CloudSavingsActionUndo.Never,
  [CloudSavingsActionKind.ResizeInstance]: CloudSavingsActionUndo.Undoable,
  [CloudSavingsActionKind.ResizeDatabase]: CloudSavingsActionUndo.Undoable,
};

export function getCloudSavingsActionUndo(data: {
  kind: CloudSavingsActionKind;
  finalSnapshot?: boolean | undefined;
}): CloudSavingsActionUndo {
  if (data.kind === CloudSavingsActionKind.DeleteVolume) {
    return data.finalSnapshot
      ? CloudSavingsActionUndo.FromSnapshot
      : CloudSavingsActionUndo.Never;
  }

  return CLOUD_SAVINGS_ACTION_UNDO[data.kind];
}

// The changes that restart what they change: the dialog says so.
export function doesCloudSavingsActionRestart(
  kind: CloudSavingsActionKind,
): boolean {
  return CLOUD_SAVINGS_RESIZE_KINDS.includes(kind);
}

/*
 * A change's life. Stored, read by the API and drawn by the Dashboard:
 * never rename one.
 */
export enum CloudSavingsActionStatus {
  // Waiting for a person who may approve it: an owner of the resource.
  Proposed = "Proposed",
  // Approved, and being made: some changes take a few steps (a snapshot first, a stop first).
  Applying = "Applying",
  // Made, after a person approved it.
  Applied = "Applied",
  // Made by OneUptime on its own, as an AI rule allows.
  AppliedWithoutAsking = "AppliedWithoutAsking",
  // Making it failed: why is on it, and what was done before it failed.
  Failed = "Failed",
  // A person said no.
  Dismissed = "Dismissed",
  // Being taken back.
  Undoing = "Undoing",
  // Made, then taken back.
  Undone = "Undone",
  // No longer needed: the saving went away, or the resource is gone.
  Expired = "Expired",
  // An off-hours schedule's stop, ended by the schedule starting it again.
  Ended = "Ended",
}

export const CLOUD_SAVINGS_ACTION_STATUSES: ReadonlyArray<CloudSavingsActionStatus> =
  Object.values(CloudSavingsActionStatus);

export function isCloudSavingsActionStatus(
  value: unknown,
): value is CloudSavingsActionStatus {
  return (
    typeof value === "string" &&
    (CLOUD_SAVINGS_ACTION_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

// Made, and standing: what Undo takes back, and what the bill is read for.
export function isCloudSavingsActionInEffect(
  status: CloudSavingsActionStatus | string | undefined,
): boolean {
  return (
    status === CloudSavingsActionStatus.Applied ||
    status === CloudSavingsActionStatus.AppliedWithoutAsking
  );
}

// Still to happen or still happening: a second request for the same resource waits for it.
export function isCloudSavingsActionOpen(
  status: CloudSavingsActionStatus | string | undefined,
): boolean {
  return (
    status === CloudSavingsActionStatus.Proposed ||
    status === CloudSavingsActionStatus.Applying ||
    status === CloudSavingsActionStatus.Undoing
  );
}

// Who started a change. Stored: a wire contract.
export enum CloudSavingsActionOrigin {
  // A person pressed Apply on the saving.
  Person = "Person",
  // An AI rule for savings proposed or made it (or the project's defaults proposed it).
  Rule = "Rule",
  // An off-hours schedule stopped it.
  Schedule = "Schedule",
}

/*
 * PROVED BY THE BILL: what the cost reads after a change say of it. A
 * change's saving is the recommender's estimate until the resource's own
 * cost is read for enough days after it; then it is what the bill says.
 */
export enum CloudSavingsMeasurement {
  // Waiting for enough days of the resource's cost after the change.
  Measuring = "Measuring",
  // The resource's cost fell: by realisedMonthlySavings a month.
  Realised = "Realised",
  // The resource's cost did not fall.
  NotSeen = "NotSeen",
  // Its cloud does not bill it by name, or its costs per resource are not read.
  CannotMeasure = "CannotMeasure",
}

export function isCloudSavingsMeasurement(
  value: unknown,
): value is CloudSavingsMeasurement {
  return (
    typeof value === "string" &&
    (Object.values(CloudSavingsMeasurement) as Array<string>).includes(value)
  );
}

// The days of cost read before a change, for what it cost a day before.
export const CLOUD_SAVINGS_BASELINE_DAYS: number = 7;

// The full days of cost after a change before its saving is said realised.
export const CLOUD_SAVINGS_MEASURE_DAYS: number = 3;

/*
 * Give up measuring after this many days: a resource whose cost never
 * arrives (a read that stopped) is said not measurable rather than
 * measuring forever.
 */
export const CLOUD_SAVINGS_MEASURE_GIVE_UP_DAYS: number = 21;

/*
 * A fall smaller than this share of what was promised is noise: the bill
 * did not show the saving.
 */
export const CLOUD_SAVINGS_REALISED_MIN_SHARE: number = 0.25;

/*
 * The changes an AI rule may make without asking, by group: a rule names
 * the groups it covers. Deletes are only ever of a volume after its final
 * snapshot; a change that cannot be undone always asks (CloudSavingsAi).
 * Stored on AI rules: a wire contract.
 */
export enum CloudSavingsActionGroup {
  Stop = "Stop",
  ChangeVolumeType = "ChangeVolumeType",
  Resize = "Resize",
  DeleteVolume = "DeleteVolume",
}

export const CLOUD_SAVINGS_ACTION_GROUPS: ReadonlyArray<CloudSavingsActionGroup> =
  [
    CloudSavingsActionGroup.Stop,
    CloudSavingsActionGroup.ChangeVolumeType,
    CloudSavingsActionGroup.Resize,
    CloudSavingsActionGroup.DeleteVolume,
  ];

export function isCloudSavingsActionGroup(
  value: unknown,
): value is CloudSavingsActionGroup {
  return (
    typeof value === "string" &&
    (CLOUD_SAVINGS_ACTION_GROUPS as ReadonlyArray<string>).includes(value)
  );
}

// The group a kind is in, or null for one no rule may make without asking.
export function getCloudSavingsActionGroup(
  kind: CloudSavingsActionKind,
): CloudSavingsActionGroup | null {
  switch (kind) {
    case CloudSavingsActionKind.StopInstance:
    case CloudSavingsActionKind.StopDatabase:
      return CloudSavingsActionGroup.Stop;
    case CloudSavingsActionKind.ChangeVolumeType:
      return CloudSavingsActionGroup.ChangeVolumeType;
    case CloudSavingsActionKind.ResizeInstance:
    case CloudSavingsActionKind.ResizeDatabase:
      return CloudSavingsActionGroup.Resize;
    case CloudSavingsActionKind.DeleteVolume:
      return CloudSavingsActionGroup.DeleteVolume;
    default:
      return null;
  }
}

export const CLOUD_SAVINGS_ACTION_GROUP_LABELS: Readonly<
  Record<CloudSavingsActionGroup, string>
> = {
  [CloudSavingsActionGroup.Stop]: translationKey(
    "Stop idle instances and databases",
  ),
  [CloudSavingsActionGroup.ChangeVolumeType]: translationKey(
    "Change gp2 volumes to gp3",
  ),
  [CloudSavingsActionGroup.Resize]: translationKey(
    "Resize instances and databases",
  ),
  [CloudSavingsActionGroup.DeleteVolume]: translationKey(
    "Delete unattached disks, after a final snapshot",
  ),
};

/*
 * ---------------------------------------------------------------------------
 * Which resource a saving is about, as its cloud names it
 * ---------------------------------------------------------------------------
 */

// What kind of thing in the cloud a change is made to.
export enum CloudSavingsTargetType {
  Instance = "Instance",
  Database = "Database",
  Volume = "Volume",
  Snapshot = "Snapshot",
  Image = "Image",
  Address = "Address",
}

/*
 * The resource a change is made to, read from its id: what the cloud's
 * API names it by, and where it is.
 */
export interface CloudSavingsTarget {
  provider: CloudProvider;
  type: CloudSavingsTargetType;
  // AWS: i-..., vol-..., snap-..., eipalloc-..., an RDS identifier. Azure and Google Cloud: its name.
  id: string;
  /*
   * AWS: its Region. Google Cloud: its zone, its Region (an address, a
   * regional disk), or "global" (an image, a global address). Azure: none,
   * its id says where.
   */
  location: string;
  /*
   * AWS: its account (empty for a snapshot, whose ARN names none). Azure:
   * its subscription. Google Cloud: its project.
   */
  account: string;
  // Azure: its resource group.
  resourceGroup?: string | undefined;
  // Azure: its full ARM id, the URL it is changed at.
  armId?: string | undefined;
  // Google Cloud: whether the location is a zone, a Region, or global.
  gcpScope?: "zone" | "region" | "global" | undefined;
}

// AWS's ids: what follows "i-", "vol-" and the rest (hexadecimal).
const AWS_ID: RegExp = /^(i|vol|snap|eipalloc)-[0-9a-f]{8,17}$/;
// An RDS identifier: a letter, then letters, digits and hyphens, at most 63.
const RDS_IDENTIFIER: RegExp = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;
// An AWS Region: "us-east-1", "us-gov-west-1", "cn-north-1".
const AWS_REGION: RegExp = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const AWS_ACCOUNT: RegExp = /^\d{12}$/;

/*
 * An ARN's parts, or null: arn:partition:service:region:account:resource.
 * The resource may itself hold colons (RDS's "db:name").
 */
function readArn(arn: string): {
  service: string;
  region: string;
  account: string;
  resource: string;
} | null {
  const parts: Array<string> = arn.split(":");

  if (parts.length < 6 || parts[0] !== "arn") {
    return null;
  }

  return {
    service: parts[2] || "",
    region: parts[3] || "",
    account: parts[4] || "",
    resource: parts.slice(5).join(":"),
  };
}

function awsTarget(data: {
  type: CloudSavingsTargetType;
  id: string;
  region: string;
  account: string;
}): CloudSavingsTarget | null {
  const region: string = data.region.trim().toLowerCase();

  if (!AWS_REGION.test(region)) {
    return null;
  }

  if (data.account && !AWS_ACCOUNT.test(data.account)) {
    return null;
  }

  return {
    provider: CloudProvider.AWS,
    type: data.type,
    id: data.id,
    location: region,
    account: data.account,
  };
}

/*
 * An AWS resource from its ARN, or from its bare id with the Region and
 * account the saving names: an EC2 instance, an EBS volume or snapshot,
 * an Elastic IP's allocation, an RDS DB instance.
 */
export function readAwsSavingsTarget(data: {
  resourceId: string;
  region: string;
  account: string;
}): CloudSavingsTarget | null {
  const value: string = (data.resourceId || "").trim();
  const arn: ReturnType<typeof readArn> = readArn(value);

  if (arn) {
    const region: string = arn.region || data.region;
    const account: string = arn.account || data.account;

    if (arn.service === "rds" && arn.resource.startsWith("db:")) {
      const identifier: string = arn.resource.slice("db:".length);

      return RDS_IDENTIFIER.test(identifier)
        ? awsTarget({
            type: CloudSavingsTargetType.Database,
            id: identifier,
            region,
            account,
          })
        : null;
    }

    if (arn.service !== "ec2") {
      return null;
    }

    const slash: number = arn.resource.indexOf("/");
    const kind: string = slash > 0 ? arn.resource.slice(0, slash) : "";
    const id: string = slash > 0 ? arn.resource.slice(slash + 1) : "";
    const types: Record<string, CloudSavingsTargetType> = {
      instance: CloudSavingsTargetType.Instance,
      volume: CloudSavingsTargetType.Volume,
      snapshot: CloudSavingsTargetType.Snapshot,
      "elastic-ip": CloudSavingsTargetType.Address,
    };
    const type: CloudSavingsTargetType | undefined = types[kind];

    if (!type || !AWS_ID.test(id)) {
      return null;
    }

    // A snapshot's ARN names no account: it is in the saving's.
    return awsTarget({ type, id, region, account });
  }

  if (!AWS_ID.test(value)) {
    return null;
  }

  const prefixes: Record<string, CloudSavingsTargetType> = {
    i: CloudSavingsTargetType.Instance,
    vol: CloudSavingsTargetType.Volume,
    snap: CloudSavingsTargetType.Snapshot,
    eipalloc: CloudSavingsTargetType.Address,
  };

  return awsTarget({
    type: prefixes[value.slice(0, value.indexOf("-"))]!,
    id: value,
    region: data.region,
    account: data.account,
  });
}

/*
 * An Azure resource from its ARM id: a VM, a managed disk, a snapshot or a
 * public IP address. ARM ids are not case sensitive; the provider and
 * type are matched so, the names kept as written.
 */
const AZURE_ID: RegExp =
  /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourceGroups\/([^/?#]{1,90})\/providers\/([A-Za-z.]+)\/([A-Za-z]+)\/([^/?#]{1,80})$/i;

export function readAzureSavingsTarget(
  resourceId: string,
): CloudSavingsTarget | null {
  const value: string = (resourceId || "").trim();
  const match: RegExpMatchArray | null = value.match(AZURE_ID);

  if (!match || value.includes("..")) {
    return null;
  }

  const type: string = `${match[3]!}/${match[4]!}`.toLowerCase();
  const types: Record<string, CloudSavingsTargetType> = {
    "microsoft.compute/virtualmachines": CloudSavingsTargetType.Instance,
    "microsoft.compute/disks": CloudSavingsTargetType.Volume,
    "microsoft.compute/snapshots": CloudSavingsTargetType.Snapshot,
    "microsoft.network/publicipaddresses": CloudSavingsTargetType.Address,
  };
  const found: CloudSavingsTargetType | undefined = types[type];

  if (!found) {
    return null;
  }

  return {
    provider: CloudProvider.Azure,
    type: found,
    id: match[5]!,
    location: "",
    account: match[1]!.toLowerCase(),
    resourceGroup: match[2]!,
    armId: value,
  };
}

// A Google Cloud name: lower case letters, digits and hyphens (or a numeric id).
const GCP_NAME: RegExp = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const GCP_PROJECT: RegExp = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const GCP_LOCATION: RegExp = /^[a-z]+-[a-z]+\d+(-[a-z])?$/;

/*
 * A Google Cloud resource from its full resource name, as the Recommender
 * writes it: //compute.googleapis.com/projects/p/zones/z/instances/i, a
 * zone's or a Region's disk, a Region's or the global address, an image.
 */
export function readGcpSavingsTarget(
  resourceId: string,
): CloudSavingsTarget | null {
  const value: string = (resourceId || "").trim();
  const prefix: string = "//compute.googleapis.com/projects/";

  if (!value.startsWith(prefix)) {
    return null;
  }

  const parts: Array<string> = value.slice(prefix.length).split("/");
  const project: string = parts[0] || "";

  if (!GCP_PROJECT.test(project)) {
    return null;
  }

  const rest: Array<string> = parts.slice(1);
  let scope: "zone" | "region" | "global";
  let location: string;
  let collection: string;
  let name: string;

  if (rest.length === 3 && rest[0] === "global") {
    scope = "global";
    location = "global";
    collection = rest[1]!;
    name = rest[2]!;
  } else if (
    rest.length === 4 &&
    (rest[0] === "zones" || rest[0] === "regions") &&
    GCP_LOCATION.test(rest[1]!)
  ) {
    scope = rest[0] === "zones" ? "zone" : "region";
    location = rest[1]!;
    collection = rest[2]!;
    name = rest[3]!;
  } else {
    return null;
  }

  if (!GCP_NAME.test(name)) {
    return null;
  }

  const allowed: Array<[string, string, CloudSavingsTargetType]> = [
    ["zone", "instances", CloudSavingsTargetType.Instance],
    ["zone", "disks", CloudSavingsTargetType.Volume],
    ["region", "disks", CloudSavingsTargetType.Volume],
    ["region", "addresses", CloudSavingsTargetType.Address],
    ["global", "addresses", CloudSavingsTargetType.Address],
    ["global", "images", CloudSavingsTargetType.Image],
  ];
  const match: [string, string, CloudSavingsTargetType] | undefined =
    allowed.find((entry: [string, string, CloudSavingsTargetType]): boolean => {
      return entry[0] === scope && entry[1] === collection;
    });

  if (!match) {
    return null;
  }

  return {
    provider: CloudProvider.GCP,
    type: match[2],
    id: name,
    location,
    account: project,
    gcpScope: scope,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Which change a saving is
 * ---------------------------------------------------------------------------
 */

// What the plan reads off a saving (CloudCostRecommendation).
export interface CloudSavingsRecommendationFacts {
  provider?: CloudProvider | string | undefined;
  kind?: CloudSavingKind | string | undefined;
  action?: string | undefined;
  resourceId?: string | undefined;
  region?: string | undefined;
  currentConfiguration?: string | undefined;
  recommendedConfiguration?: string | undefined;
  // The account's id in its cloud: AWS's account, for a bare id.
  accountId?: string | undefined;
}

/*
 * The change a saving is, as OneUptime would make it: what it changes, to
 * what, and how it is taken back.
 */
export interface CloudSavingsActionPlan {
  kind: CloudSavingsActionKind;
  target: CloudSavingsTarget;
  // What it is now, and what it becomes: "gp2" -> "gp3", "m5.2xlarge" -> "m5.xlarge".
  from?: string | undefined;
  to?: string | undefined;
  /*
   * A deleted disk: whether a final snapshot is offered (the person
   * chooses, ticked by default), or always taken (Google Cloud's "Snapshot
   * and delete disk" says so itself).
   */
  finalSnapshot?: "offered" | "always" | undefined;
  restarts: boolean;
}

/*
 * Why OneUptime does not make a saving's change, said on its row. A wire
 * contract: the API sends it.
 */
export enum CloudSavingsNotOffered {
  // A commitment: bought in the cloud's console, never by OneUptime.
  Commitment = "Commitment",
  // A change of more than one step, or of a kind OneUptime does not make.
  NotOneStep = "NotOneStep",
  // An Arm (Graviton) size: needs an image built for Arm.
  NeedsArmImage = "NeedsArmImage",
  // The saving does not say what to change it to.
  NoTarget = "NoTarget",
  // The saving names no resource OneUptime can find in its cloud.
  NoResource = "NoResource",
}

export type CloudSavingsActionPlanResult =
  | { plan: CloudSavingsActionPlan; notOffered?: undefined }
  | { plan?: undefined; notOffered: CloudSavingsNotOffered };

function notOffered(reason: CloudSavingsNotOffered): {
  notOffered: CloudSavingsNotOffered;
} {
  return { notOffered: reason };
}

// An instance type ("m5.large", "t3a.medium", "Standard_D2s_v5", "e2-small"), from a summary.
const AWS_INSTANCE_TYPE: RegExp =
  /\b([a-z][a-z0-9-]*\d[a-z0-9-]*\.[0-9]*[a-z0-9]+)\b/;
const AWS_DB_CLASS: RegExp = /\b(db\.[a-z0-9]+\.[0-9]*[a-z0-9]+)\b/;
const AZURE_VM_SIZE: RegExp = /\b((?:Standard|Basic)_[A-Za-z0-9_]+)\b/;
const GCP_MACHINE_TYPE: RegExp = /\b([a-z][a-z0-9]*-[a-z0-9-]+)\b/;
// An AWS Arm family: a "g" right after the generation ("m6g", "c7gd", "t4g").
const AWS_ARM_FAMILY: RegExp = /^[a-z]+\d+g[a-z]*$/;
// Google Cloud's Arm machine series.
const GCP_ARM_MACHINE: RegExp = /^(t2a|c4a)-/;

// The first instance type a recommender's summary names, or "".
export function readAwsInstanceType(summary: string | undefined): string {
  const text: string = (summary || "").trim();

  if (AWS_DB_CLASS.test(text)) {
    return "";
  }

  const match: RegExpMatchArray | null = text.match(AWS_INSTANCE_TYPE);
  return match ? match[1]! : "";
}

export function readAwsDatabaseClass(summary: string | undefined): string {
  const match: RegExpMatchArray | null = (summary || "").match(AWS_DB_CLASS);
  return match ? match[1]! : "";
}

export function readAzureVmSize(summary: string | undefined): string {
  const match: RegExpMatchArray | null = (summary || "").match(AZURE_VM_SIZE);
  return match ? match[1]! : "";
}

export function readGcpMachineType(summary: string | undefined): string {
  const text: string = (summary || "").trim();
  // A full URL's last part: ".../machineTypes/e2-small".
  const last: string = text.slice(text.lastIndexOf("/") + 1);
  const match: RegExpMatchArray | null = last.match(GCP_MACHINE_TYPE);
  return match ? match[1]! : "";
}

/*
 * An Arm (Graviton) size: a family with a "g" right after its generation
 * - m6g, m7gd, c6gn, t4g, x2gd, im4gn - or a1. A GPU family's "g4dn" is
 * not one.
 */
export function isAwsArmInstanceType(instanceType: string): boolean {
  const family: string = (instanceType || "").split(".")[0] || "";

  return family === "a1" || AWS_ARM_FAMILY.test(family);
}

// A volume type a summary names: "gp2", "gp3", "io1"...
const EBS_VOLUME_TYPE: RegExp = /\b(gp2|gp3|io1|io2|st1|sc1|standard)\b/;
function readEbsVolumeType(summary: string | undefined): string {
  const match: RegExpMatchArray | null = (summary || "")
    .toLowerCase()
    .match(EBS_VOLUME_TYPE);
  return match ? match[1]! : "";
}

// What a saving's action word says to do, in OneUptime's words or the recommender's.
function says(action: string | undefined, ...words: Array<string>): boolean {
  const text: string = (action || "").trim().toLowerCase();

  return words.some((word: string): boolean => {
    return text === word || text.startsWith(`${word} `);
  });
}

function awsPlan(
  facts: CloudSavingsRecommendationFacts,
): CloudSavingsActionPlanResult {
  const target: CloudSavingsTarget | null = readAwsSavingsTarget({
    resourceId: facts.resourceId || "",
    region: facts.region || "",
    account: facts.accountId || "",
  });

  if (!target) {
    return notOffered(CloudSavingsNotOffered.NoResource);
  }

  const action: string | undefined = facts.action;
  const isStop: boolean = says(action, "stop");
  const isDelete: boolean = says(action, "delete");
  const isResize: boolean = says(action, "rightsize", "upgrade", "scale in");

  if (says(action, "migrate to graviton")) {
    return notOffered(CloudSavingsNotOffered.NeedsArmImage);
  }

  switch (target.type) {
    case CloudSavingsTargetType.Instance: {
      if (isStop || facts.kind === CloudSavingKind.Idle) {
        return {
          plan: {
            kind: CloudSavingsActionKind.StopInstance,
            target,
            restarts: false,
          },
        };
      }

      if (!isResize) {
        return notOffered(CloudSavingsNotOffered.NotOneStep);
      }

      const from: string = readAwsInstanceType(facts.currentConfiguration);
      const to: string = readAwsInstanceType(facts.recommendedConfiguration);

      if (!to || to === from) {
        return notOffered(CloudSavingsNotOffered.NoTarget);
      }

      if (isAwsArmInstanceType(to) !== isAwsArmInstanceType(from || to)) {
        return notOffered(CloudSavingsNotOffered.NeedsArmImage);
      }

      return {
        plan: {
          kind: CloudSavingsActionKind.ResizeInstance,
          target,
          from: from || undefined,
          to,
          restarts: true,
        },
      };
    }
    case CloudSavingsTargetType.Database: {
      if (isStop || facts.kind === CloudSavingKind.Idle) {
        return {
          plan: {
            kind: CloudSavingsActionKind.StopDatabase,
            target,
            restarts: false,
          },
        };
      }

      if (!isResize) {
        return notOffered(CloudSavingsNotOffered.NotOneStep);
      }

      const from: string = readAwsDatabaseClass(facts.currentConfiguration);
      const to: string = readAwsDatabaseClass(facts.recommendedConfiguration);

      if (!to || to === from) {
        return notOffered(CloudSavingsNotOffered.NoTarget);
      }

      if (
        isAwsArmInstanceType(to.slice("db.".length)) !==
        isAwsArmInstanceType((from || to).slice("db.".length))
      ) {
        return notOffered(CloudSavingsNotOffered.NeedsArmImage);
      }

      return {
        plan: {
          kind: CloudSavingsActionKind.ResizeDatabase,
          target,
          from: from || undefined,
          to,
          restarts: true,
        },
      };
    }
    case CloudSavingsTargetType.Volume: {
      if (isDelete || facts.kind === CloudSavingKind.Idle) {
        return {
          plan: {
            kind: CloudSavingsActionKind.DeleteVolume,
            target,
            finalSnapshot: "offered",
            restarts: false,
          },
        };
      }

      const from: string = readEbsVolumeType(facts.currentConfiguration);
      const to: string = readEbsVolumeType(facts.recommendedConfiguration);

      if (from === "gp2" && to === "gp3") {
        return {
          plan: {
            kind: CloudSavingsActionKind.ChangeVolumeType,
            target,
            from,
            to,
            restarts: false,
          },
        };
      }

      return notOffered(CloudSavingsNotOffered.NotOneStep);
    }
    case CloudSavingsTargetType.Snapshot:
      return isDelete || facts.kind === CloudSavingKind.Idle
        ? {
            plan: {
              kind: CloudSavingsActionKind.DeleteSnapshot,
              target,
              restarts: false,
            },
          }
        : notOffered(CloudSavingsNotOffered.NotOneStep);
    case CloudSavingsTargetType.Address:
      return isDelete ||
        says(action, "release") ||
        facts.kind === CloudSavingKind.Idle
        ? {
            plan: {
              kind: CloudSavingsActionKind.ReleaseAddress,
              target,
              restarts: false,
            },
          }
        : notOffered(CloudSavingsNotOffered.NotOneStep);
    default:
      return notOffered(CloudSavingsNotOffered.NotOneStep);
  }
}

function azurePlan(
  facts: CloudSavingsRecommendationFacts,
): CloudSavingsActionPlanResult {
  const target: CloudSavingsTarget | null = readAzureSavingsTarget(
    facts.resourceId || "",
  );

  if (!target) {
    return notOffered(CloudSavingsNotOffered.NoResource);
  }

  if (target.type === CloudSavingsTargetType.Instance) {
    if (facts.kind === CloudSavingKind.Rightsize) {
      const from: string = readAzureVmSize(facts.currentConfiguration);
      const to: string = readAzureVmSize(facts.recommendedConfiguration);

      if (!to || to.toLowerCase() === from.toLowerCase()) {
        return notOffered(CloudSavingsNotOffered.NoTarget);
      }

      return {
        plan: {
          kind: CloudSavingsActionKind.ResizeInstance,
          target,
          from: from || undefined,
          to,
          restarts: true,
        },
      };
    }

    return facts.kind === CloudSavingKind.Idle
      ? {
          plan: {
            kind: CloudSavingsActionKind.StopInstance,
            target,
            restarts: false,
          },
        }
      : notOffered(CloudSavingsNotOffered.NotOneStep);
  }

  if (facts.kind !== CloudSavingKind.Idle) {
    return notOffered(CloudSavingsNotOffered.NotOneStep);
  }

  const kinds: Partial<Record<CloudSavingsTargetType, CloudSavingsActionKind>> =
    {
      [CloudSavingsTargetType.Volume]: CloudSavingsActionKind.DeleteVolume,
      [CloudSavingsTargetType.Snapshot]: CloudSavingsActionKind.DeleteSnapshot,
      [CloudSavingsTargetType.Address]: CloudSavingsActionKind.ReleaseAddress,
    };
  const kind: CloudSavingsActionKind | undefined = kinds[target.type];

  if (!kind) {
    return notOffered(CloudSavingsNotOffered.NotOneStep);
  }

  return {
    plan: {
      kind,
      target,
      restarts: false,
      ...(kind === CloudSavingsActionKind.DeleteVolume
        ? { finalSnapshot: "offered" as const }
        : {}),
    },
  };
}

function gcpPlan(
  facts: CloudSavingsRecommendationFacts,
): CloudSavingsActionPlanResult {
  const target: CloudSavingsTarget | null = readGcpSavingsTarget(
    facts.resourceId || "",
  );

  if (!target) {
    return notOffered(CloudSavingsNotOffered.NoResource);
  }

  const action: string | undefined = facts.action;

  switch (target.type) {
    case CloudSavingsTargetType.Instance: {
      if (says(action, "stop vm", "stop")) {
        return {
          plan: {
            kind: CloudSavingsActionKind.StopInstance,
            target,
            restarts: false,
          },
        };
      }

      if (
        !says(action, "change machine type") &&
        facts.kind !== CloudSavingKind.Rightsize
      ) {
        return notOffered(CloudSavingsNotOffered.NotOneStep);
      }

      const from: string = readGcpMachineType(facts.currentConfiguration);
      const to: string = readGcpMachineType(facts.recommendedConfiguration);

      if (!to || to === from) {
        return notOffered(CloudSavingsNotOffered.NoTarget);
      }

      // Google Cloud's Arm machines (t2a, c4a) need an Arm image too.
      if (GCP_ARM_MACHINE.test(to) !== GCP_ARM_MACHINE.test(from || to)) {
        return notOffered(CloudSavingsNotOffered.NeedsArmImage);
      }

      return {
        plan: {
          kind: CloudSavingsActionKind.ResizeInstance,
          target,
          from: from || undefined,
          to,
          restarts: true,
        },
      };
    }
    case CloudSavingsTargetType.Volume:
      if (says(action, "snapshot and delete disk")) {
        return {
          plan: {
            kind: CloudSavingsActionKind.DeleteVolume,
            target,
            finalSnapshot: "always",
            restarts: false,
          },
        };
      }

      return says(action, "delete disk", "delete")
        ? {
            plan: {
              kind: CloudSavingsActionKind.DeleteVolume,
              target,
              finalSnapshot: "offered",
              restarts: false,
            },
          }
        : notOffered(CloudSavingsNotOffered.NotOneStep);
    case CloudSavingsTargetType.Address:
      return says(action, "delete address", "delete")
        ? {
            plan: {
              kind: CloudSavingsActionKind.ReleaseAddress,
              target,
              restarts: false,
            },
          }
        : notOffered(CloudSavingsNotOffered.NotOneStep);
    case CloudSavingsTargetType.Image:
      return says(action, "delete image", "delete")
        ? {
            plan: {
              kind: CloudSavingsActionKind.DeleteImage,
              target,
              restarts: false,
            },
          }
        : notOffered(CloudSavingsNotOffered.NotOneStep);
    default:
      return notOffered(CloudSavingsNotOffered.NotOneStep);
  }
}

/*
 * The change a saving is, or why OneUptime does not make it. A commitment
 * is never bought; anything else is the one step its cloud's API makes, or
 * not offered.
 */
export function getCloudSavingsActionPlan(
  facts: CloudSavingsRecommendationFacts,
): CloudSavingsActionPlanResult {
  if (facts.kind === CloudSavingKind.Commitment) {
    return notOffered(CloudSavingsNotOffered.Commitment);
  }

  switch (facts.provider) {
    case CloudProvider.AWS:
      return awsPlan(facts);
    case CloudProvider.Azure:
      return azurePlan(facts);
    case CloudProvider.GCP:
      return gcpPlan(facts);
    default:
      return notOffered(CloudSavingsNotOffered.NoResource);
  }
}

/*
 * Where a commitment is bought, in its cloud's own console: OneUptime
 * never buys one (the issue's second decision), so a "Commit to use"
 * saving links here.
 */
export const CLOUD_COMMITMENT_PURCHASE_URLS: Readonly<
  Record<CloudProvider, string>
> = {
  [CloudProvider.AWS]:
    "https://console.aws.amazon.com/costmanagement/home#/savings-plans/recommendations",
  [CloudProvider.Azure]:
    "https://portal.azure.com/#view/Microsoft_Azure_Reservations/CreateBlade",
  [CloudProvider.GCP]: "https://console.cloud.google.com/compute/commitments",
};

/*
 * ---------------------------------------------------------------------------
 * The words a person reads
 * ---------------------------------------------------------------------------
 */

// The button, and the approval card's title, of each kind.
export const CLOUD_SAVINGS_ACTION_TITLES: Readonly<
  Record<CloudSavingsActionKind, string>
> = {
  [CloudSavingsActionKind.StopInstance]: translationKey("Stop Instance"),
  [CloudSavingsActionKind.StopDatabase]: translationKey("Stop Database"),
  [CloudSavingsActionKind.ChangeVolumeType]:
    translationKey("Change Volume Type"),
  [CloudSavingsActionKind.DeleteVolume]: translationKey("Delete Disk"),
  [CloudSavingsActionKind.DeleteSnapshot]: translationKey("Delete Snapshot"),
  [CloudSavingsActionKind.DeleteImage]: translationKey("Delete Image"),
  [CloudSavingsActionKind.ReleaseAddress]: translationKey("Release Address"),
  [CloudSavingsActionKind.ResizeInstance]: translationKey("Resize Instance"),
  [CloudSavingsActionKind.ResizeDatabase]: translationKey("Resize Database"),
};

// What each kind changes, in one sentence: the dialog's first line.
export const CLOUD_SAVINGS_ACTION_SENTENCES: Readonly<
  Record<CloudSavingsActionKind, string>
> = {
  [CloudSavingsActionKind.StopInstance]: translationKey(
    "Stops {{resource}}. Its disks are kept, and it can be started again at any time.",
  ),
  [CloudSavingsActionKind.StopDatabase]: translationKey(
    "Stops {{resource}}. Its data is kept. AWS starts a stopped database again after seven days.",
  ),
  [CloudSavingsActionKind.ChangeVolumeType]: translationKey(
    "Changes {{resource}} from {{from}} to {{to}}, with no downtime. It can be changed back after six hours.",
  ),
  [CloudSavingsActionKind.DeleteVolume]: translationKey(
    "Deletes {{resource}}, which nothing is attached to.",
  ),
  [CloudSavingsActionKind.DeleteSnapshot]: translationKey(
    "Deletes the snapshot {{resource}}.",
  ),
  [CloudSavingsActionKind.DeleteImage]: translationKey(
    "Deletes the image {{resource}}.",
  ),
  [CloudSavingsActionKind.ReleaseAddress]: translationKey(
    "Releases the address {{resource}}, which nothing uses.",
  ),
  [CloudSavingsActionKind.ResizeInstance]: translationKey(
    "Resizes {{resource}} from {{from}} to {{to}}. It restarts, so it is down for a few minutes.",
  ),
  [CloudSavingsActionKind.ResizeDatabase]: translationKey(
    "Resizes {{resource}} from {{from}} to {{to}}. It restarts, so it is down for a few minutes.",
  ),
};

export const CLOUD_SAVINGS_UNDO_SENTENCES: Readonly<
  Record<CloudSavingsActionUndo, string>
> = {
  [CloudSavingsActionUndo.Undoable]: translationKey(
    "Can be undone with one press.",
  ),
  [CloudSavingsActionUndo.FromSnapshot]: translationKey(
    "Can be undone: the disk is made again from its final snapshot.",
  ),
  [CloudSavingsActionUndo.Never]: translationKey("Cannot be undone."),
};

export const CLOUD_SAVINGS_NOT_OFFERED_SENTENCES: Readonly<
  Record<CloudSavingsNotOffered, string>
> = {
  [CloudSavingsNotOffered.Commitment]: translationKey(
    "OneUptime never buys a commitment. Buy it in your cloud's console.",
  ),
  [CloudSavingsNotOffered.NotOneStep]: translationKey(
    "This change takes more than one step, so make it in your cloud's console.",
  ),
  [CloudSavingsNotOffered.NeedsArmImage]: translationKey(
    "An Arm size needs an image built for Arm, so make this change in your cloud's console.",
  ),
  [CloudSavingsNotOffered.NoTarget]: translationKey(
    "The recommendation does not say what to change it to.",
  ),
  [CloudSavingsNotOffered.NoResource]: translationKey(
    "OneUptime cannot tell which resource this is in your cloud.",
  ),
};

export const CLOUD_SAVINGS_ACTION_STATUS_LABELS: Readonly<
  Record<CloudSavingsActionStatus, string>
> = {
  [CloudSavingsActionStatus.Proposed]: translationKey("Waiting for approval"),
  [CloudSavingsActionStatus.Applying]: translationKey("Applying"),
  [CloudSavingsActionStatus.Applied]: translationKey("Applied"),
  [CloudSavingsActionStatus.AppliedWithoutAsking]: translationKey(
    "Applied by an AI rule",
  ),
  [CloudSavingsActionStatus.Failed]: translationKey("Failed"),
  [CloudSavingsActionStatus.Dismissed]: translationKey("Dismissed"),
  [CloudSavingsActionStatus.Undoing]: translationKey("Undoing"),
  [CloudSavingsActionStatus.Undone]: translationKey("Undone"),
  [CloudSavingsActionStatus.Expired]: translationKey("Expired"),
  [CloudSavingsActionStatus.Ended]: translationKey("Started again"),
};

export const CLOUD_SAVINGS_MEASUREMENT_LABELS: Readonly<
  Record<CloudSavingsMeasurement, string>
> = {
  [CloudSavingsMeasurement.Measuring]: translationKey("Checking the bill"),
  [CloudSavingsMeasurement.Realised]: translationKey("Seen in the bill"),
  [CloudSavingsMeasurement.NotSeen]: translationKey("Not seen in the bill"),
  [CloudSavingsMeasurement.CannotMeasure]: translationKey("Cannot be measured"),
};
