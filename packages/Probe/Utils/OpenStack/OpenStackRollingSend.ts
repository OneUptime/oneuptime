import {
  OPENSTACK_SUMMARY_MODE_SERIES,
  isOpenStackSeriesKeptInSummaryMode,
} from "Common/Types/OpenStack/OpenStackScale";

/*
 * Past the summary size, what a collection sends of the parts a cloud holds hundreds of thousands
 * of: what changed, what someone chose to keep, what is in a state an alert watches, and whatever
 * is due. Everything else was sent lately and has not changed, so sending it again says nothing a
 * page could read. Every row still comes round within a stated time, the cycle, which is what lets
 * the stale-row rule tell a row nobody sent from a part that has gone.
 *
 * A collection is read whole either way, and counts and totals are worked out from the whole.
 * This only decides what goes in the upload, and only for a cloud in summary mode: below that size
 * every collection sends everything, as the agent does.
 *
 * The series a monitor needs in every window (a worker's state, a hypervisor's numbers, the
 * address pools) are not here, and go every time.
 *
 * Each part keeps the time it is next due, rather than a turn that comes up every so many
 * collections. A turn only helps if the collection it falls on reads the part, and these can miss
 * one: identity and images are read every second collection or so, so half their turns would never
 * come up at all, and a read that failed would leave its parts a whole cycle behind, long enough
 * for the stale-row rule to take them. A due time waits for the next read that can say anything
 * about the part, whenever that is. So a part goes at most a cycle and one read's wait between two
 * sends, however the reads fell.
 */

export interface OpenStackSendGate {
  shouldSend: (
    metricName: string,
    labels: Record<string, string | number | boolean | null | undefined>,
    value: number | null,
  ) => boolean;
}

/*
 * The series sent in turns, each with the label that names its part and the statuses that say
 * nothing about it needs watching. A part whose status is anything else goes every time: a series
 * that goes away reads as recovered.
 */
interface RollingSeries {
  idLabel: string;
  statusLabel?: string | undefined;
  settled?: ReadonlySet<string> | undefined;
}

const ACTIVE: ReadonlySet<string> = new Set(["ACTIVE"]);

export const OPENSTACK_ROLLING_SERIES: ReadonlyMap<string, RollingSeries> =
  new Map<string, RollingSeries>([
    ["openstack_nova_server_status", { idLabel: "id" }],
    [
      "openstack_cinder_volume_gb",
      {
        idLabel: "id",
        statusLabel: "status",
        settled: new Set(["available", "in-use"]),
      },
    ],
    [
      "openstack_cinder_volume_status",
      {
        idLabel: "id",
        statusLabel: "status",
        settled: new Set(["available", "in-use"]),
      },
    ],
    [
      "openstack_cinder_snapshot_gb",
      { idLabel: "id", statusLabel: "status", settled: new Set(["available"]) },
    ],
    [
      "openstack_cinder_backup_gb",
      { idLabel: "id", statusLabel: "status", settled: new Set(["available"]) },
    ],
    [
      "openstack_neutron_network",
      { idLabel: "id", statusLabel: "status", settled: ACTIVE },
    ],
    ["openstack_neutron_subnet", { idLabel: "id" }],
    [
      "openstack_neutron_router",
      { idLabel: "id", statusLabel: "status", settled: ACTIVE },
    ],
    [
      "openstack_neutron_floating_ip",
      {
        idLabel: "id",
        statusLabel: "status",
        settled: new Set(["ACTIVE", "DOWN"]),
      },
    ],
    ["openstack_glance_image_bytes", { idLabel: "id" }],
    [
      "openstack_glance_image_created_at",
      {
        idLabel: "id",
        statusLabel: "status",
        settled: new Set(["active"]),
      },
    ],
    ["openstack_identity_project_info", { idLabel: "id" }],
  ]);

/*
 * FNV-1a: only ever compared with itself, so a collision costs one row one cycle's wait. A hash runs
 * over every label of every part a collection reads, hundreds of millions of characters at the
 * largest size, so this goes straight to the function rather than looking it up each time.
 */
const imul: (first: number, second: number) => number = Math.imul;

function hashOf(text: string): number {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

const HASH_RANGE: number = 2 ** 32;

/*
 * A part's moment of the cycle, from its ID, as a fraction. FNV leaves the last characters of what
 * it hashed in the low bits, and IDs often differ only there, so this mixes them across the whole
 * number before reading the high ones.
 */
function shareOfCycle(partId: string): number {
  let hash: number = hashOf(partId);

  hash ^= hash >>> 16;
  hash = imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return (hash >>> 0) / HASH_RANGE;
}

function textOf(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/*
 * How long a part nobody has said anything about stays remembered. A read can fail for a while
 * without its parts having gone, and forgetting one only sends it once more.
 */
const FORGOTTEN_AFTER_CYCLES: number = 2;
const MINIMUM_REMEMBERED_FOR_IN_MS: number = 2 * 60 * 60_000;

// One series of one part.
export interface OpenStackRollingEntry {
  // What was last read of it, as a hash.
  hash: number;
  dueAt: number;
  seenAt: number;
}

export interface OpenStackRollingState {
  entries: Map<string, OpenStackRollingEntry>;
  // Whether it is sending in turns now: a cloud can shrink out of it and grow back.
  isActive: boolean;
  // How many collections a cycle is. See getOpenStackRollingTurns.
  turns: number;
  cycleInMs: number;
  collectionIntervalInMs: number;
  // When this probe began sending this cloud in turns.
  startedAt: number;
  /*
   * Until when what has never been sent waits for its share of the first cycle, rather than going
   * at once. A part that appears after that is new, and goes at once.
   */
  firstCycleEndsAt: number;
  // Until when its reads vouch for nothing: see getsToVouchForRows.
  vouchesFrom: number;
  sweptAt: number;
}

export function createOpenStackRollingState(): OpenStackRollingState {
  return {
    entries: new Map(),
    isActive: false,
    turns: 0,
    cycleInMs: 0,
    collectionIntervalInMs: 0,
    startedAt: 0,
    firstCycleEndsAt: 0,
    vouchesFrom: 0,
    sweptAt: 0,
  };
}

/*
 * Begins or carries on sending in turns.
 *
 * The first time, nothing is known of what the server holds. A cloud of 200,000 instances sent
 * whole is half a gigabyte of JSON, longer than this process can hold as one string, and every
 * restart of the probe would ask it again of a server that already has nearly all of it. So each
 * part goes at its own moment of the first cycle, as it does of every later one, and a new cloud's
 * lists fill over that cycle. The Data Collection card says so.
 *
 * Until each row has come round, a read says nothing about the ones it held back: they might have
 * last been sent any time ago, by this probe before it restarted or by another. So until then
 * reads do not vouch for rows. The same goes for a while after a cycle shrinks, because a row
 * given a time by the old one goes on waiting for it.
 */
export function startOpenStackRollingCycle(data: {
  state: OpenStackRollingState;
  now: number;
  turns: number;
  collectionIntervalInMs: number;
}): void {
  const { state, now } = data;
  const turns: number = Math.max(1, data.turns);
  const cycleInMs: number = turns * data.collectionIntervalInMs;

  if (!state.isActive) {
    state.entries.clear();
    state.isActive = true;
    state.startedAt = now;
    state.firstCycleEndsAt = now + cycleInMs;
    state.vouchesFrom = Math.max(state.vouchesFrom, now + cycleInMs);
    state.sweptAt = now;
  } else if (cycleInMs < state.cycleInMs) {
    state.vouchesFrom = Math.max(state.vouchesFrom, now + state.cycleInMs);
  }

  state.turns = turns;
  state.cycleInMs = cycleInMs;
  state.collectionIntervalInMs = data.collectionIntervalInMs;
}

/*
 * A cloud that fell back below the summary size. This collection sends every row, in as many
 * uploads as that takes, and the next can vouch for them.
 */
export function stopOpenStackRollingCycle(data: {
  state: OpenStackRollingState;
  now: number;
  collectionIntervalInMs: number;
}): void {
  const { state } = data;

  if (state.isActive) {
    state.isActive = false;
    state.entries.clear();
    state.vouchesFrom = Math.max(
      state.vouchesFrom,
      data.now + data.collectionIntervalInMs,
    );
  }
}

/*
 * Whether a read made now says anything about the rows it did not send. openstack_<service>_up says
 * so, because it is what the stale-row rule measures from: it deletes what its service's reads have
 * gone on without. A read that cannot speak for a row must not move that.
 */
export function getsToVouchForRows(
  state: OpenStackRollingState | undefined,
  now: number,
): boolean {
  return !state || now >= state.vouchesFrom;
}

export default class OpenStackRollingSend implements OpenStackSendGate {
  public heldBack: number = 0;

  private readonly state: OpenStackRollingState;
  private readonly now: number;
  private readonly keptProjectIds: ReadonlySet<string>;

  public constructor(data: {
    state: OpenStackRollingState;
    now: number;
    keptProjectIds: ReadonlyArray<string>;
  }) {
    this.state = data.state;
    this.now = data.now;
    this.keptProjectIds = new Set(data.keptProjectIds);
    this.forgetWhatHasGone();
  }

  public shouldSend(
    metricName: string,
    labels: Record<string, string | number | boolean | null | undefined>,
    value: number | null,
  ): boolean {
    const series: RollingSeries | undefined =
      OPENSTACK_ROLLING_SERIES.get(metricName);

    if (!series) {
      return true;
    }

    const partId: string = textOf(labels[series.idLabel]);

    if (!partId || this.isWatched(metricName, series, labels)) {
      return true;
    }

    let text: string = textOf(value);

    for (const key of Object.keys(labels)) {
      text += `|${textOf(labels[key])}`;
    }

    const hash: number = hashOf(text);
    const key: string = `${metricName}/${partId}`;
    const entry: OpenStackRollingEntry | undefined =
      this.state.entries.get(key);

    if (!entry) {
      return this.sendsWhatIsFirstSeen(key, partId, hash);
    }

    const isChanged: boolean = entry.hash !== hash;

    entry.hash = hash;
    entry.seenAt = this.now;

    if (entry.dueAt <= this.now) {
      /*
       * Its next time is the same moment of a later cycle, not a cycle from now, so what is spread
       * out stays spread out, even after an outage has left a lot of it overdue at once.
       */
      entry.dueAt +=
        this.state.cycleInMs *
        (1 + Math.floor((this.now - entry.dueAt) / this.state.cycleInMs));

      return true;
    }

    if (isChanged) {
      return true;
    }

    this.heldBack++;

    return false;
  }

  /*
   * A part's moment of the cycle comes from its ID, so the series of one part come round together
   * and a row is refreshed whole. Each collection takes the moments up to the next one, so the
   * first takes its share too, and the whole first cycle is `turns` collections.
   */
  private sendsWhatIsFirstSeen(
    key: string,
    partId: string,
    hash: number,
  ): boolean {
    const { state } = this;
    const moment: number = shareOfCycle(partId) * state.cycleInMs;

    // One that appears after the first cycle is new, and goes now.
    if (this.now >= state.firstCycleEndsAt) {
      state.entries.set(key, {
        hash: hash,
        dueAt: this.now + moment,
        seenAt: this.now,
      });

      return true;
    }

    const dueAt: number =
      state.startedAt + moment - state.collectionIntervalInMs;

    if (dueAt > this.now) {
      state.entries.set(key, { hash: hash, dueAt: dueAt, seenAt: this.now });
      this.heldBack++;

      return false;
    }

    state.entries.set(key, {
      hash: hash,
      dueAt: dueAt + state.cycleInMs,
      seenAt: this.now,
    });

    return true;
  }

  // A part nothing has read lately has gone, or moved: memory does not grow for ever with churn.
  private forgetWhatHasGone(): void {
    const { state } = this;
    const rememberedFor: number = Math.max(
      state.cycleInMs * FORGOTTEN_AFTER_CYCLES,
      MINIMUM_REMEMBERED_FOR_IN_MS,
    );

    if (this.now - state.sweptAt < rememberedFor / 2) {
      return;
    }

    state.sweptAt = this.now;

    for (const [key, entry] of state.entries) {
      if (this.now - entry.seenAt >= rememberedFor) {
        state.entries.delete(key);
      }
    }
  }

  private isWatched(
    metricName: string,
    series: RollingSeries,
    labels: Record<string, string | number | boolean | null | undefined>,
  ): boolean {
    if (OPENSTACK_SUMMARY_MODE_SERIES.has(metricName)) {
      return isOpenStackSeriesKeptInSummaryMode({
        metricName: metricName,
        status: textOf(labels["status"]),
        projectId: textOf(labels["tenant_id"]),
        keptProjectIds: this.keptProjectIds,
      });
    }

    // What the address pool templates divide by: an external network is watched whatever it says.
    if (
      metricName === "openstack_neutron_network" &&
      textOf(labels["is_external"]) === "true"
    ) {
      return true;
    }

    if (!series.settled || !series.statusLabel) {
      return false;
    }

    return !series.settled.has(textOf(labels[series.statusLabel]));
  }
}
