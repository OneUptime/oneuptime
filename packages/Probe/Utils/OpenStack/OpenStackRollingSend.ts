import {
  OPENSTACK_SUMMARY_MODE_SERIES,
  isOpenStackSeriesKeptInSummaryMode,
} from "Common/Types/OpenStack/OpenStackScale";

/*
 * Past the summary size, what a collection sends of the parts a cloud holds hundreds of thousands
 * of: what changed, what someone chose to keep, what is in a state an alert watches, and a turn's
 * share of the rest. Everything else was sent lately and has not changed, so sending it again says
 * nothing a page could read. Each row still comes round within a stated time, which is what lets
 * the stale-row rule tell a row nobody sent from a part that has gone.
 *
 * A collection is read whole either way, and counts and totals are worked out from the whole.
 * This only decides what goes in the upload, and only for a cloud in summary mode: below that size
 * every collection sends everything, as the agent does.
 *
 * The series a monitor needs in every window (a worker's state, a hypervisor's numbers, the
 * address pools) are not here, and go every time.
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

// FNV-1a: only ever compared with itself, so a collision costs one row one turn's wait.
function hashOf(text: string): number {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function textOf(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export interface OpenStackRollingState {
  // Per series and part, what was last sent, as a hash.
  sent: Map<string, number>;
  turn: number;
  turns?: number | undefined;
}

export function createOpenStackRollingState(): OpenStackRollingState {
  return { sent: new Map(), turn: 0 };
}

export default class OpenStackRollingSend implements OpenStackSendGate {
  public heldBack: number = 0;

  private readonly state: OpenStackRollingState;
  private readonly turns: number;
  private readonly keptProjectIds: ReadonlySet<string>;

  public constructor(data: {
    state: OpenStackRollingState;
    turns: number;
    keptProjectIds: ReadonlyArray<string>;
  }) {
    this.state = data.state;
    this.turns = Math.max(1, data.turns);
    this.keptProjectIds = new Set(data.keptProjectIds);
    this.state.turn = (this.state.turn + 1) % this.turns;
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

    const key: string = `${metricName}/${partId}`;
    const hash: number = hashOf(text);
    const isChanged: boolean = this.state.sent.get(key) !== hash;

    // The series of one part come round together, so a row is refreshed whole.
    if (isChanged || hashOf(partId) % this.turns === this.state.turn) {
      this.state.sent.set(key, hash);
      return true;
    }

    this.heldBack++;

    return false;
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
