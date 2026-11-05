import {
  isOpenStackContainerClusterStuck,
  isOpenStackBareMetalNodeStuck,
  isOpenStackImageStuck,
  isOpenStackInstanceStuck,
  isOpenStackStackStuck,
  isOpenStackVolumeStuck,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_API_STATUS_CLOSED,
  OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
  OPENSTACK_STACK_FAILED_STATUSES,
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceStatusTone } from "../Infrastructure/ResourceTable";

/*
 * How a row's state reads in an OpenStack list: OpenStack's own word, with a
 * tone that says whether to look at it. Pure, so the rules are tested on their
 * own and every list reads a word the same way.
 *
 *  - The word is never translated or reworded: ACTIVE stays ACTIVE, in-use stays
 *    in-use, because it is what `openstack server list` shows the same person.
 *  - The one word that is ours is "Disabled". A service someone disabled, or a
 *    Neutron agent with its admin state down, is planned work whatever its state
 *    says, so it reads Disabled with the operator's reason and never as a failure.
 *  - A word this file does not know is neutral: a new OpenStack release's word is
 *    shown as it is, and is not called a failure on a guess.
 *  - A step on its way to something else is only something to look at once it has
 *    taken longer than the alert templates allow. A list that knows the time reads a
 *    BUILD of two minutes as neutral and one of two hours as Stuck, which is its own
 *    state because that is what the person scanning the list is looking for.
 *  - A hypervisor whose nova-compute stopped reads Lost, because Nova keeps reporting
 *    its last numbers and "down" beside them would read as a host with room.
 *
 * These are a list's tones, not health. What needs someone first is #5723's
 * OpenStackHealth, whose thresholds are the alert templates'.
 */

export interface OpenStackStatusInput {
  kind: string | null | undefined;
  status: string | null | undefined;
  adminState?: string | null | undefined;
  disabledReason?: string | null | undefined;
  // True when the agent's last read of this API failed (facts.scrapeFailed).
  isScrapeFailed?: boolean | undefined;
  /*
   * When its status last changed, and the time now. A reading without them cannot
   * tell a step taking its time from a step stuck, so it reads every step as one to
   * look at.
   */
  stateChangedAt?: Date | string | null | undefined;
  // When Ironic itself says a node last moved, which is better than when a read noticed.
  provisionUpdatedAt?: Date | string | null | undefined;
  now?: Date | undefined;
}

export interface OpenStackStatusReading {
  label: string;
  tone: ResourceStatusTone;
  // True for OpenStack's own word, drawn as written in every language.
  isOpenStackWord: boolean;
  // The operator's words, as written. Never looked up.
  writtenReason?: string | undefined;
  // English to look up, when OneUptime says why.
  reasonKey?: string | undefined;
  // On its way to something else for longer than the alert templates allow.
  isStuck?: boolean | undefined;
}

export const OPENSTACK_DISABLED_LABEL: string = translationKey("Disabled");

export const OPENSTACK_SCRAPE_FAILED_REASON: string = translationKey(
  "The agent's last read of this API failed.",
);

export const OPENSTACK_STUCK_LABEL: string = translationKey("Stuck");

export const OPENSTACK_LOST_LABEL: string = translationKey("Lost");

export const OPENSTACK_CLOSED_LABEL: string = translationKey(
  "Closed to this credential",
);

/*
 * Nova and Cinder say enabled and disabled, Neutron says up and down. Both mean
 * what an operator set, not what the service is doing.
 */
export function isOpenStackAdminDisabled(
  adminState: string | null | undefined,
): boolean {
  const word: string = (adminState || "").trim().toLowerCase();
  return word === "disabled" || word === "down";
}

function serviceTone(word: string): ResourceStatusTone {
  const lower: string = word.toLowerCase();
  if (lower === OPENSTACK_SERVICE_STATUS_UP) {
    return "positive";
  }
  return lower === OPENSTACK_SERVICE_STATUS_DOWN ? "danger" : "neutral";
}

function instanceTone(word: string): ResourceStatusTone {
  const upper: string = word.toUpperCase();
  if (upper === "ACTIVE") {
    return "positive";
  }
  if (upper === "ERROR") {
    return "danger";
  }
  /*
   * UNKNOWN is Nova saying it lost touch with the instance. SHUTOFF, PAUSED,
   * SUSPENDED and SHELVED are what someone asked for, so they stay neutral.
   */
  return upper === "UNKNOWN" ||
    OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(upper) ||
    OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(word)
    ? "warning"
    : "neutral";
}

function volumeTone(word: string): ResourceStatusTone {
  const lower: string = word.toLowerCase();
  if (lower === "available" || lower === "in-use") {
    return "positive";
  }
  if (OPENSTACK_VOLUME_ERROR_STATUSES.has(lower)) {
    return "danger";
  }
  return OPENSTACK_VOLUME_TRANSITIONAL_STATUSES.has(lower)
    ? "warning"
    : "neutral";
}

function imageTone(word: string): ResourceStatusTone {
  const lower: string = word.toLowerCase();
  if (lower === "active") {
    return "positive";
  }
  if (lower === "killed") {
    return "danger";
  }
  return OPENSTACK_IMAGE_TRANSITIONAL_STATUSES.has(lower) ||
    lower === "pending_delete"
    ? "warning"
    : "neutral";
}

function networkTone(word: string): ResourceStatusTone {
  const upper: string = word.toUpperCase();
  if (upper === "ACTIVE") {
    return "positive";
  }
  if (upper === "ERROR") {
    return "danger";
  }
  return ["BUILD", "ALLOCATED", "DOWN"].includes(upper) ? "warning" : "neutral";
}

/*
 * Neutron says DOWN for a floating IP with nothing behind it, which is an
 * address waiting to be used and nothing to look at.
 */
function floatingIpTone(word: string): ResourceStatusTone {
  const upper: string = word.toUpperCase();
  if (upper === "ACTIVE") {
    return "positive";
  }
  return upper === "ERROR" ? "danger" : "neutral";
}

/*
 * `available` and `active` are what a node is for. The rest of what is not failed or on its way, such
 * as enroll and manageable, is where someone left it, and says nothing is wrong.
 */
function bareMetalTone(word: string): ResourceStatusTone {
  const lower: string = word.toLowerCase();
  if (lower === "available" || lower === "active") {
    return "positive";
  }
  if (OPENSTACK_BARE_METAL_ERROR_STATES.has(lower)) {
    return "danger";
  }
  return OPENSTACK_BARE_METAL_TRANSITIONAL_STATES.has(lower)
    ? "warning"
    : "neutral";
}

function enabledTone(word: string): ResourceStatusTone {
  return word.toLowerCase() === "enabled" ? "positive" : "neutral";
}

/*
 * Heat and Magnum say what they did and how it went in one word. What someone asked to stop or be
 * undone (a stack suspended, an update rolled back) ended as asked, so it stays neutral, and so does
 * what nothing is ever done with.
 */
const STACK_OR_CLUSTER_NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  "SUSPEND_COMPLETE",
  "ROLLBACK_COMPLETE",
  "INIT_COMPLETE",
  "DELETE_COMPLETE",
]);

function stackOrClusterTone(word: string): ResourceStatusTone {
  const upper: string = word.toUpperCase();
  if (
    OPENSTACK_STACK_FAILED_STATUSES.has(upper) ||
    OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES.has(upper)
  ) {
    return "danger";
  }
  if (
    OPENSTACK_STACK_IN_PROGRESS_STATUSES.has(upper) ||
    OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES.has(upper)
  ) {
    return "warning";
  }
  return upper.endsWith("_COMPLETE") &&
    !STACK_OR_CLUSTER_NEUTRAL_WORDS.has(upper)
    ? "positive"
    : "neutral";
}

function toneOf(
  kind: string | null | undefined,
  word: string,
): ResourceStatusTone {
  switch (kind) {
    case OpenStackResourceKind.Api:
    case OpenStackResourceKind.Service:
    case OpenStackResourceKind.Hypervisor:
      return serviceTone(word);
    case OpenStackResourceKind.Instance:
      return instanceTone(word);
    case OpenStackResourceKind.Volume:
    case OpenStackResourceKind.Snapshot:
    case OpenStackResourceKind.Backup:
      return volumeTone(word);
    case OpenStackResourceKind.Image:
      return imageTone(word);
    case OpenStackResourceKind.Network:
    case OpenStackResourceKind.Router:
      return networkTone(word);
    case OpenStackResourceKind.FloatingIp:
      return floatingIpTone(word);
    case OpenStackResourceKind.BareMetalNode:
      return bareMetalTone(word);
    case OpenStackResourceKind.Project:
    case OpenStackResourceKind.Domain:
      return enabledTone(word);
    case OpenStackResourceKind.Stack:
    case OpenStackResourceKind.ContainerCluster:
      return stackOrClusterTone(word);
    default:
      return "neutral";
  }
}

function isStuck(input: OpenStackStatusInput, word: string): boolean {
  if (!input.now) {
    return false;
  }
  const reading: {
    status: string;
    stateChangedAt: Date | string | null | undefined;
    now: Date;
  } = { status: word, stateChangedAt: input.stateChangedAt, now: input.now };
  switch (input.kind) {
    case OpenStackResourceKind.Instance:
      return isOpenStackInstanceStuck(reading);
    case OpenStackResourceKind.Volume:
      return isOpenStackVolumeStuck(reading);
    case OpenStackResourceKind.Image:
      return isOpenStackImageStuck(reading);
    case OpenStackResourceKind.Stack:
      return isOpenStackStackStuck(reading);
    case OpenStackResourceKind.ContainerCluster:
      return isOpenStackContainerClusterStuck(reading);
    case OpenStackResourceKind.BareMetalNode:
      return isOpenStackBareMetalNodeStuck({
        ...reading,
        adminState: input.adminState,
        provisionUpdatedAt: input.provisionUpdatedAt,
      });
    default:
      return false;
  }
}

// A step on its way to something else, as each kind's own rule draws it.
function isOnTheWay(kind: string | null | undefined, word: string): boolean {
  switch (kind) {
    case OpenStackResourceKind.Instance:
      return OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(word);
    case OpenStackResourceKind.Volume:
      return OPENSTACK_VOLUME_TRANSITIONAL_STATUSES.has(word);
    case OpenStackResourceKind.Image:
      return OPENSTACK_IMAGE_TRANSITIONAL_STATUSES.has(word);
    case OpenStackResourceKind.Stack:
      return OPENSTACK_STACK_IN_PROGRESS_STATUSES.has(word);
    case OpenStackResourceKind.ContainerCluster:
      return OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES.has(word);
    case OpenStackResourceKind.BareMetalNode:
      return OPENSTACK_BARE_METAL_TRANSITIONAL_STATES.has(word);
    default:
      return false;
  }
}

/*
 * The reading of one row, or null for a row with no state to show: a storage pool
 * reports none, and a dash says so better than a guess.
 */
export function getOpenStackStatusReading(
  input: OpenStackStatusInput,
): OpenStackStatusReading | null {
  if (isOpenStackAdminDisabled(input.adminState)) {
    const reason: string = (input.disabledReason || "").trim();
    return {
      label: OPENSTACK_DISABLED_LABEL,
      tone: "neutral",
      isOpenStackWord: false,
      writtenReason: reason || undefined,
    };
  }

  const word: string = (input.status || "").trim();
  if (!word) {
    return null;
  }

  // Ours, so it is looked up, and it says nothing about whether the API answers.
  if (word === OPENSTACK_API_STATUS_CLOSED) {
    return {
      label: OPENSTACK_CLOSED_LABEL,
      tone: "neutral",
      isOpenStackWord: false,
    };
  }

  if (
    input.kind === OpenStackResourceKind.Hypervisor &&
    word.toLowerCase() === OPENSTACK_SERVICE_STATUS_DOWN
  ) {
    return {
      label: OPENSTACK_LOST_LABEL,
      tone: "danger",
      isOpenStackWord: false,
    };
  }

  if (isStuck(input, word)) {
    return {
      label: OPENSTACK_STUCK_LABEL,
      tone: "warning",
      isOpenStackWord: false,
      isStuck: true,
    };
  }

  return {
    label: word,
    tone:
      input.now && isOnTheWay(input.kind, word)
        ? "neutral"
        : toneOf(input.kind, word),
    isOpenStackWord: true,
    reasonKey:
      input.isScrapeFailed &&
      word.toLowerCase() === OPENSTACK_SERVICE_STATUS_DOWN
        ? OPENSTACK_SCRAPE_FAILED_REASON
        : undefined,
  };
}

/*
 * The words a list's Status filter offers, in the order OpenStack's own docs
 * list them, from the same sets the rules above read. Filtering is a query on
 * (projectId, openStackCloudId, kind, status), so a filter never reads every row.
 */
export const OPENSTACK_STATUS_WORDS: Partial<
  Record<OpenStackResourceKind, ReadonlyArray<string>>
> = {
  [OpenStackResourceKind.Api]: [
    OPENSTACK_SERVICE_STATUS_UP,
    OPENSTACK_SERVICE_STATUS_DOWN,
  ],
  [OpenStackResourceKind.Service]: [
    OPENSTACK_SERVICE_STATUS_UP,
    OPENSTACK_SERVICE_STATUS_DOWN,
  ],
  [OpenStackResourceKind.Hypervisor]: [
    OPENSTACK_SERVICE_STATUS_UP,
    OPENSTACK_SERVICE_STATUS_DOWN,
  ],
  [OpenStackResourceKind.Instance]: [
    "ACTIVE",
    "ERROR",
    "SHUTOFF",
    "PAUSED",
    "SUSPENDED",
    "SHELVED",
    "SHELVED_OFFLOADED",
    "RESCUE",
    "UNKNOWN",
    ...OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  ],
  [OpenStackResourceKind.Volume]: [
    "available",
    "in-use",
    ...OPENSTACK_VOLUME_ERROR_STATUSES,
    ...OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  ],
  [OpenStackResourceKind.Image]: [
    "active",
    ...OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
    "pending_delete",
    "deactivated",
    "killed",
  ],
  [OpenStackResourceKind.Snapshot]: [
    "available",
    "creating",
    "deleting",
    "restoring",
    "error",
    "error_deleting",
  ],
  [OpenStackResourceKind.Backup]: [
    "available",
    "creating",
    "deleting",
    "restoring",
    "error",
  ],
  [OpenStackResourceKind.Network]: ["ACTIVE", "BUILD", "DOWN", "ERROR"],
  [OpenStackResourceKind.Router]: ["ACTIVE", "ALLOCATED", "DOWN", "ERROR"],
  [OpenStackResourceKind.FloatingIp]: ["ACTIVE", "DOWN", "ERROR"],
  [OpenStackResourceKind.Project]: ["enabled", "disabled"],
  [OpenStackResourceKind.Stack]: [
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    ...Array.from(OPENSTACK_STACK_FAILED_STATUSES),
    ...Array.from(OPENSTACK_STACK_IN_PROGRESS_STATUSES),
    "ROLLBACK_COMPLETE",
    "SUSPEND_COMPLETE",
    "RESUME_COMPLETE",
    "CHECK_COMPLETE",
    "SNAPSHOT_COMPLETE",
    "ADOPT_COMPLETE",
    "INIT_COMPLETE",
    "DELETE_COMPLETE",
  ],
  [OpenStackResourceKind.ContainerCluster]: [
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    ...Array.from(OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES),
    ...Array.from(OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES),
    "RESUME_COMPLETE",
    "RESTORE_COMPLETE",
    "ROLLBACK_COMPLETE",
    "SNAPSHOT_COMPLETE",
    "CHECK_COMPLETE",
    "ADOPT_COMPLETE",
    "DELETE_COMPLETE",
  ],
  [OpenStackResourceKind.BareMetalNode]: [
    "available",
    "active",
    ...OPENSTACK_BARE_METAL_ERROR_STATES,
    ...OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
    "enroll",
    "manageable",
    "rescue",
    "deploy hold",
    "clean hold",
    "service hold",
  ],
};
