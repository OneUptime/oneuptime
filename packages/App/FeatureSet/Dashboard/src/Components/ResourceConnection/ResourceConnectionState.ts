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
 */
export enum ResourceConnectionState {
  Connected = "connected",
  NeverConnected = "never-connected",
  Disconnected = "disconnected",
}

export interface ResourceConnectionInput {
  status: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
}

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

export const getResourceConnectionState: (
  input: ResourceConnectionInput,
) => ResourceConnectionState = (
  input: ResourceConnectionInput,
): ResourceConnectionState => {
  if (isResourceStatusConnected(input.status)) {
    return ResourceConnectionState.Connected;
  }

  return getResourceLastSeenDate(input.lastSeenAt)
    ? ResourceConnectionState.Disconnected
    : ResourceConnectionState.NeverConnected;
};
