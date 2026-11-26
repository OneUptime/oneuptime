import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceConnectionState,
  getResourceConnectionState,
} from "../../../Components/ResourceConnection/ResourceConnectionState";
import { getResourceConnectionLabel } from "../../../Components/TelemetryResource/ResourceHeroStatus";

/*
 * WHERE AN XCP-NG POOL STANDS WITH THE XEN ORCHESTRA IT IS READ FROM, as its
 * hero pill, the pools list and the card under the hero say it.
 *
 * A pool is Connected while it is READ: the server refreshes lastSeenAt
 * only from a batch that carried what Xen Orchestra says about the pool -
 * its hosts, VMs, storage repositories or its connection - and marks it
 * Disconnected 15 minutes after its last read
 * (XcpNgPoolService.markDisconnectedPools). Xen Orchestra stops reporting a
 * pool it lost (xcp_pool_connected goes away rather than to 0) while it
 * keeps reporting its other pools, so one pool can go quiet while its
 * agent runs on.
 *
 * The agent keeps a second clock, agentLastSeenAt: when it last sent
 * anything that names the pool. While that is recent and the pool is not
 * read, the pill says "Can't read API" instead of a Connected that was never
 * true, or a Disconnected that sends people to an agent that is fine; and
 * "Waiting for data" while the pool has never been read yet, as in the
 * minute after it was added by its UUID. A pool whose agent was never heard
 * either reads Disconnected, or - never read at all - never connected.
 *
 * One reading of the state (getResourceConnectionState) and one source of
 * its words (getResourceConnectionLabel), so the pill, the list and the card
 * under the hero can never disagree. A plain function of a Translator, free
 * of React, so a test can hand it any language and clock.
 */

export interface XcpNgPoolConnectionInput {
  otelCollectorStatus?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  agentLastSeenAt?: Date | string | null | undefined;
}

export interface XcpNgPoolConnection {
  state: ResourceConnectionState;
  // Read now: its inventory, and the health worked out from it, are current.
  isConnected: boolean;
  label: string;
  // The hero's pill and its dot.
  badgeClassName: string;
  dotClassName: string;
  // The pools list's dot and words.
  listDotClassName: string;
  listTextClassName: string;
}

interface ConnectionColors {
  badgeClassName: string;
  dotClassName: string;
  listDotClassName: string;
  listTextClassName: string;
}

const COLORS: Record<ResourceConnectionState, ConnectionColors> = {
  [ResourceConnectionState.Connected]: {
    badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dotClassName: "bg-emerald-500",
    listDotClassName: "bg-emerald-500",
    listTextClassName: "text-emerald-700",
  },
  // The agent runs, the pool is not read: something to act on.
  [ResourceConnectionState.ReadingStopped]: {
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-200",
    dotClassName: "bg-amber-500",
    listDotClassName: "bg-amber-500",
    listTextClassName: "text-amber-700",
  },
  // A first read on its way, as the card under the hero says it.
  [ResourceConnectionState.NotReadYet]: {
    badgeClassName: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    dotClassName: "bg-indigo-500",
    listDotClassName: "bg-indigo-500",
    listTextClassName: "text-indigo-700",
  },
  // Nothing arrives at all: amber in the hero, red in the list.
  [ResourceConnectionState.Disconnected]: {
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-200",
    dotClassName: "bg-amber-500",
    listDotClassName: "bg-red-500",
    listTextClassName: "text-red-700",
  },
  [ResourceConnectionState.NeverConnected]: {
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-200",
    dotClassName: "bg-amber-500",
    listDotClassName: "bg-red-500",
    listTextClassName: "text-red-700",
  },
};

export const getXcpNgPoolConnection: (input: {
  pool: XcpNgPoolConnectionInput;
  translator: Translator;
  now?: Date | undefined;
}) => XcpNgPoolConnection = (input: {
  pool: XcpNgPoolConnectionInput;
  translator: Translator;
  now?: Date | undefined;
}): XcpNgPoolConnection => {
  const state: ResourceConnectionState = getResourceConnectionState({
    status: input.pool.otelCollectorStatus,
    lastSeenAt: input.pool.lastSeenAt,
    agentLastSeenAt: input.pool.agentLastSeenAt,
    now: input.now,
  });
  const isConnected: boolean = state === ResourceConnectionState.Connected;

  return {
    state,
    isConnected,
    label: getResourceConnectionLabel({
      translator: input.translator,
      isConnected: isConnected,
      status: input.pool.otelCollectorStatus,
      connectionState: state,
    }),
    ...COLORS[state],
  };
};
