import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceConnectionState,
  getResourceConnectionState,
} from "../../../Components/ResourceConnection/ResourceConnectionState";
import { getResourceConnectionLabel } from "../../../Components/TelemetryResource/ResourceHeroStatus";

/*
 * WHERE A PROXMOX CLUSTER STANDS WITH ITS AGENT, as its hero pill and the
 * clusters list say it (issue #7439).
 *
 * The cluster is Connected while it is READ: the server refreshes lastSeenAt
 * only from a batch that carried what the Proxmox VE API says about it. Its
 * agent keeps a second clock, agentLastSeenAt, for anything it sends at all
 * - its own scrape metrics included. So while the agent runs but cannot read
 * the API (the node it reads went down, no node answers, the token was
 * revoked) the pill says "Can't read API" instead of a Connected that was
 * never true, or a Disconnected that sends people to a container that is
 * fine; and "Waiting for data" while the agent has never read the cluster
 * yet, as in the minute after install.
 *
 * One reading of the state (getResourceConnectionState) and one source of
 * its words (getResourceConnectionLabel), so the pill, the list and the card
 * under the hero can never disagree. A plain function of a Translator, free
 * of React, so a test can hand it any language and clock.
 */

export interface ProxmoxClusterConnectionInput {
  otelCollectorStatus?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  agentLastSeenAt?: Date | string | null | undefined;
}

export interface ProxmoxClusterConnection {
  state: ResourceConnectionState;
  // Read now: its inventory, and the health worked out from it, are current.
  isConnected: boolean;
  label: string;
  // The hero's pill and its dot.
  badgeClassName: string;
  dotClassName: string;
  // The clusters list's dot and words.
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
  // The agent runs, the API does not answer it: something to act on.
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
  // Nothing arrives at all: the colours each page drew Disconnected in.
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

export const getProxmoxClusterConnection: (input: {
  cluster: ProxmoxClusterConnectionInput;
  translator: Translator;
  now?: Date | undefined;
}) => ProxmoxClusterConnection = (input: {
  cluster: ProxmoxClusterConnectionInput;
  translator: Translator;
  now?: Date | undefined;
}): ProxmoxClusterConnection => {
  const state: ResourceConnectionState = getResourceConnectionState({
    status: input.cluster.otelCollectorStatus,
    lastSeenAt: input.cluster.lastSeenAt,
    agentLastSeenAt: input.cluster.agentLastSeenAt,
    now: input.now,
  });
  const isConnected: boolean = state === ResourceConnectionState.Connected;

  return {
    state,
    isConnected,
    label: getResourceConnectionLabel({
      translator: input.translator,
      isConnected: isConnected,
      status: input.cluster.otelCollectorStatus,
      connectionState: state,
    }),
    ...COLORS[state],
  };
};
