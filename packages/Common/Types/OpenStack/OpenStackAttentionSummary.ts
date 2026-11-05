import { JSONObject, JSONValue } from "../JSON";
import {
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  getOpenStackRouterAgents,
  isOpenStackServiceDown,
  isOpenStackServiceForcedDown,
  percentOf,
} from "./OpenStackHealthRules";
import {
  getOpenStackDependencyOfRow,
  isOpenStackControlPlaneRowCurrent,
} from "./OpenStackControlPlane";
import { OpenStackResourceKind } from "./OpenStackResourceKind";

/*
 * WHAT A CLOUD'S PAGE WOULD SAY NEEDS ATTENTION, FOR AN INVESTIGATION TO READ FIRST.
 *
 * The rows are OpenStackResourceService.getAttentionRows, the same read the page makes, and
 * a row is in trouble by the same lines (OpenStackHealthRules). What this leaves to the page
 * is the words and the ranking: the page's OpenStackHealth is React's, and writes a person's
 * sentences, where a model needs the facts and which part they are about. Rows the read keeps
 * only so the rules can count them, such as a healthy hypervisor, are dropped here.
 *
 * Pure, and the names in it are whoever wrote them: whoever prints these makes them fields.
 */

export interface OpenStackAttentionRow {
  kind: OpenStackResourceKind;
  name: string;
  // Its ID where a command can read it by that ID. A service's row has none it could use.
  id: string | null;
  // Where it sits, in the words of what it sits on.
  where: string | null;
  why: string;
  // What Nova recorded about why it failed, in its own words.
  message: string | null;
}

export interface OpenStackAttentionSummary {
  rows: Array<OpenStackAttentionRow>;
  // How many more of each kind there are than `rows` holds.
  moreByKind: Partial<Record<OpenStackResourceKind, number>>;
  // Whether the cloud has reported its services at all: nothing wrong means little otherwise.
  hasServiceRows: boolean;
}

// The order an investigation reads them in: what everything stands on comes first.
const KIND_ORDER: ReadonlyArray<OpenStackResourceKind> = [
  OpenStackResourceKind.Api,
  OpenStackResourceKind.ControlPlane,
  OpenStackResourceKind.Service,
  OpenStackResourceKind.Hypervisor,
  OpenStackResourceKind.StoragePool,
  OpenStackResourceKind.Instance,
  OpenStackResourceKind.Volume,
  OpenStackResourceKind.Router,
  OpenStackResourceKind.Network,
  OpenStackResourceKind.FloatingIp,
  OpenStackResourceKind.Image,
  OpenStackResourceKind.Project,
];

// The kinds whose row's externalId is what a command takes as an ID.
const KINDS_READ_BY_ID: ReadonlySet<OpenStackResourceKind> = new Set([
  OpenStackResourceKind.Instance,
  OpenStackResourceKind.Volume,
  OpenStackResourceKind.Router,
  OpenStackResourceKind.Network,
  OpenStackResourceKind.FloatingIp,
  OpenStackResourceKind.Image,
  OpenStackResourceKind.Project,
]);

function text(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOf(value: JSONValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function factsOf(row: JSONObject): JSONObject {
  return (row["facts"] as JSONObject | undefined) || {};
}

/*
 * Why this row needs someone, or null when the read only kept it so the rules could count
 * it. Kinds the read itself filters say what the filter found.
 */
function whyOf(row: JSONObject, now: Date): string | null {
  const status: string | null = text(row["status"]);
  const adminState: string | null = text(row["adminState"]);
  const facts: JSONObject = factsOf(row);

  switch (row["kind"]) {
    case OpenStackResourceKind.Api:
      return "not answering";
    case OpenStackResourceKind.ControlPlane:
      if (
        !getOpenStackDependencyOfRow(row as never) ||
        !isOpenStackControlPlaneRowCurrent({ row: row as never, now }) ||
        !isOpenStackServiceDown({ status, adminState })
      ) {
        return null;
      }
      return "down";
    case OpenStackResourceKind.Service:
      if (!isOpenStackServiceDown({ status, adminState })) {
        return null;
      }
      return isOpenStackServiceForcedDown({ status, facts })
        ? "down, and an operator forced it down"
        : "down";
    case OpenStackResourceKind.Hypervisor:
      if (!isOpenStackServiceDown({ status, adminState })) {
        return null;
      }
      return numberOf(row["instanceCount"])
        ? `down, holding ${row["instanceCount"]} instances`
        : "down";
    case OpenStackResourceKind.StoragePool: {
      const percent: number | null = percentOf(
        numberOf(row["diskAllocatedBytes"]),
        numberOf(row["diskCapacityBytes"]),
      );
      return percent !== null &&
        percent > OPENSTACK_STORAGE_POOL_WARNING_PERCENT
        ? `${Math.round(percent)}% full`
        : null;
    }
    case OpenStackResourceKind.Instance:
    case OpenStackResourceKind.Volume:
    case OpenStackResourceKind.Image:
      return `status ${status || "unknown"}${
        status === "ERROR" || status === "error" ? "" : ", for longer than it should take"
      }`;
    case OpenStackResourceKind.Network:
      return "almost out of addresses";
    case OpenStackResourceKind.Router: {
      if (status && status !== "ACTIVE") {
        return `status ${status}`;
      }
      const agents: ReadonlyArray<{ isAlive: boolean; isAdminUp: boolean }> =
        getOpenStackRouterAgents(facts);
      return agents.length > 0 &&
        !agents.some((agent: { isAlive: boolean; isAdminUp: boolean }) => {
          return agent.isAlive && agent.isAdminUp;
        })
        ? "no L3 agent alive to hold it"
        : null;
    }
    case OpenStackResourceKind.FloatingIp:
      return `in use, status ${status || "unknown"}`;
    case OpenStackResourceKind.Project:
      return "near a quota";
    default:
      return null;
  }
}

function whereOf(row: JSONObject): string | null {
  if (row["kind"] === OpenStackResourceKind.Service) {
    return text(factsOf(row)["host"]);
  }
  if (row["kind"] === OpenStackResourceKind.Instance) {
    return text(row["hypervisorName"]);
  }

  return text(row["regionName"]);
}

export function summarizeOpenStackAttention(data: {
  rows: ReadonlyArray<JSONObject>;
  totalsByKind: Readonly<Record<string, number>>;
  now: Date;
  rowsPerKind: number;
}): OpenStackAttentionSummary {
  const summary: OpenStackAttentionSummary = {
    rows: [],
    moreByKind: {},
    hasServiceRows: data.rows.some((row: JSONObject): boolean => {
      return row["kind"] === OpenStackResourceKind.Service;
    }),
  };

  for (const kind of KIND_ORDER) {
    const found: Array<OpenStackAttentionRow> = [];

    for (const row of data.rows) {
      if (row["kind"] !== kind) {
        continue;
      }

      const why: string | null = whyOf(row, data.now);

      if (!why) {
        continue;
      }

      found.push({
        kind,
        name: text(row["name"]) || text(row["externalId"]) || "",
        id: KINDS_READ_BY_ID.has(kind) ? text(row["externalId"]) : null,
        where: whereOf(row),
        why,
        message: text(factsOf(row)["faultMessage"]),
      });
    }

    summary.rows.push(...found.slice(0, data.rowsPerKind));

    /*
     * A kind read with a limit has more than the rows it brought back, which its total says.
     * A kind read whole keeps its healthy rows too, so only what was found counts there.
     */
    const isReadWhole: boolean =
      kind === OpenStackResourceKind.Service ||
      kind === OpenStackResourceKind.Hypervisor ||
      kind === OpenStackResourceKind.ControlPlane;
    const total: number = isReadWhole
      ? found.length
      : Math.max(found.length, data.totalsByKind[kind] || 0);
    const shown: number = Math.min(found.length, data.rowsPerKind);

    if (total > shown) {
      summary.moreByKind[kind] = total - shown;
    }
  }

  return summary;
}
