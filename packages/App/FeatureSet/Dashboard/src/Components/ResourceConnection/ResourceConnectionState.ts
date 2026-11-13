/*
 * Where an agent-fed resource (a Kubernetes cluster, a Docker host, a
 * vCenter, ...) stands with OneUptime, as its overview needs to explain it.
 *
 * The hero badge only says "Connected" or "Disconnected", and a resource
 * created by hand reads "Disconnected" from the moment it exists, before any
 * agent was ever installed. Those are two different situations with two
 * different next steps, so they are told apart here:
 *
 * - Connected: the agent is reporting. Nothing to explain.
 * - NeverConnected: nothing has ever arrived (no lastSeenAt). The resource
 *   needs its agent installed.
 * - Disconnected: data arrived before (lastSeenAt is set) and has stopped.
 *   The agent needs looking at.
 *
 * "connected" and "active" both count as connected, case-insensitively -
 * the same reading every overview hero gives its badge, so the badge and the
 * guide below it can never disagree.
 *
 * A resource whose agent reads it from an API (a Proxmox cluster) keeps a
 * second clock, agentLastSeenAt: when the agent last sent anything, read or
 * not. While that is recent and the resource is not connected, the agent is
 * running but cannot read the resource - not stopped (issue #7439):
 *
 * - ReadingStopped: it was read before (lastSeenAt is set) and is not now.
 *   The API needs looking at, not the agent.
 * - NotReadYet: it has never been read. Usually a minute after install,
 *   before the first read; when it stays, the API needs looking at too.
 *
 * Without agentLastSeenAt - every other kind of resource - these never come
 * up and the three states above are all there is.
 */
export enum ResourceConnectionState {
  Connected = "connected",
  NeverConnected = "never-connected",
  Disconnected = "disconnected",
  ReadingStopped = "reading-stopped",
  NotReadYet = "not-read-yet",
}

export interface ResourceConnectionInput {
  status: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  // When the agent last sent anything, read or not (agentLastSeenAt).
  agentLastSeenAt?: Date | string | null | undefined;
  // The clock agentLastSeenAt is judged against; now when left out.
  now?: Date | undefined;
}

/*
 * How long after the agent was last heard it still counts as running: the
 * same 15 minutes the server waits before it marks a resource Disconnected.
 * The agent's heartbeat is fenced to about once every 5 minutes, so a
 * running agent is never older than that - 15 leaves room for two missed
 * beats and a clock a little off.
 */
export const RESOURCE_AGENT_HEARD_WINDOW_MS: number = 15 * 60 * 1000;

export const isResourceStatusConnected: (
  status: string | null | undefined,
) => boolean = (status: string | null | undefined): boolean => {
  const normalized: string = (status || "").toLowerCase();
  return normalized === "connected" || normalized === "active";
};

/*
 * The last time anything arrived, or null when nothing ever has. A value
 * that does not parse to a real date is treated as never seen: "last seen
 * Invalid Date ago" helps nobody.
 */
export const getResourceLastSeenDate: (
  lastSeenAt: Date | string | null | undefined,
) => Date | null = (
  lastSeenAt: Date | string | null | undefined,
): Date | null => {
  if (!lastSeenAt) {
    return null;
  }

  const date: Date =
    lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);

  return isNaN(date.getTime()) ? null : date;
};

/*
 * Whether the agent was heard within RESOURCE_AGENT_HEARD_WINDOW_MS of `now`.
 * A time ahead of now - the reader's clock a little behind the server's -
 * counts as heard.
 */
export const isResourceAgentHeard: (input: {
  agentLastSeenAt: Date | string | null | undefined;
  now?: Date | undefined;
}) => boolean = (input: {
  agentLastSeenAt: Date | string | null | undefined;
  now?: Date | undefined;
}): boolean => {
  const heardAt: Date | null = getResourceLastSeenDate(input.agentLastSeenAt);
  if (!heardAt) {
    return false;
  }
  const nowMs: number = (input.now || new Date()).getTime();
  return nowMs - heardAt.getTime() <= RESOURCE_AGENT_HEARD_WINDOW_MS;
};

export const getResourceConnectionState: (
  input: ResourceConnectionInput,
) => ResourceConnectionState = (
  input: ResourceConnectionInput,
): ResourceConnectionState => {
  if (isResourceStatusConnected(input.status)) {
    return ResourceConnectionState.Connected;
  }

  const wasRead: boolean = Boolean(getResourceLastSeenDate(input.lastSeenAt));

  if (
    isResourceAgentHeard({
      agentLastSeenAt: input.agentLastSeenAt,
      now: input.now,
    })
  ) {
    return wasRead
      ? ResourceConnectionState.ReadingStopped
      : ResourceConnectionState.NotReadYet;
  }

  return wasRead
    ? ResourceConnectionState.Disconnected
    : ResourceConnectionState.NeverConnected;
};
