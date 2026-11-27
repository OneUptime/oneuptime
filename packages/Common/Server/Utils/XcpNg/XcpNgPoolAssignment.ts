import XcpNgCollectionMethod from "../../../Types/XcpNg/XcpNgCollectionMethod";

/*
 * WHICH POOLS A PROBE CONNECTION'S READ MAY WRITE.
 *
 * A pool is read by exactly one source - the XCP-ng Agent, or one probe
 * connection - so its metrics never arrive twice and its history stays one
 * line whichever reads it (#10996). When a connection reports a pool:
 *
 *   pool                                  the connection's data for it
 *   ------------------------------------  --------------------------------
 *   not there yet                         creates it, read by this connection
 *   read by this connection               is stored
 *   read by a probe, no connection        is stored: this connection takes it
 *     (its connection was removed)          over
 *   read by the XCP-ng Agent (as every    is stored: this connection takes it
 *     pool registered before probes         over, and the pool's feed says to
 *     could read one)                       stop the agent
 *   switched back to the agent from       is dropped: a person chose the
 *     this connection                       agent for it
 *   read by another connection            is dropped: that one reads it
 *   switched back to the agent from       is dropped
 *     another connection
 *
 * Switching a pool on its Settings writes the same two columns: "Use the
 * XCP-ng Agent" keeps the connection named and sets the method to Agent,
 * so the connection's reads of it are dropped from then on; "Collect With a
 * Probe" names a connection again.
 *
 * Pure, so it is held to every case by a unit test.
 */

export enum XcpNgPoolAssignmentDecision {
  // A pool nobody registered yet: made, read by this connection.
  Create = "Create",
  // Already read by this connection.
  Keep = "Keep",
  // Read by the agent, or by a connection since removed: this one reads it now.
  TakeOver = "TakeOver",
  // A person switched it to the agent: left to the agent.
  LeaveToAgent = "LeaveToAgent",
  // Another connection reads it.
  LeaveToOtherConnection = "LeaveToOtherConnection",
}

export interface XcpNgPoolReadBy {
  collectionMethod?: XcpNgCollectionMethod | string | null | undefined;
  xcpNgConnectionId?: { toString: () => string } | string | null | undefined;
}

function idOf(
  value: { toString: () => string } | string | null | undefined,
): string | null {
  const text: string = value ? value.toString().trim().toLowerCase() : "";
  return text || null;
}

export function decideXcpNgPoolAssignment(data: {
  pool: XcpNgPoolReadBy | null;
  connectionId: { toString: () => string } | string;
}): XcpNgPoolAssignmentDecision {
  if (!data.pool) {
    return XcpNgPoolAssignmentDecision.Create;
  }

  const connectionId: string | null = idOf(data.connectionId);
  const poolConnectionId: string | null = idOf(data.pool.xcpNgConnectionId);
  const isProbe: boolean =
    data.pool.collectionMethod === XcpNgCollectionMethod.Probe;

  if (isProbe) {
    if (poolConnectionId === null) {
      return XcpNgPoolAssignmentDecision.TakeOver;
    }

    return poolConnectionId === connectionId
      ? XcpNgPoolAssignmentDecision.Keep
      : XcpNgPoolAssignmentDecision.LeaveToOtherConnection;
  }

  // Read by the agent: as registered, or switched back by a person.
  if (poolConnectionId === null) {
    return XcpNgPoolAssignmentDecision.TakeOver;
  }

  return XcpNgPoolAssignmentDecision.LeaveToAgent;
}

// Whether the connection's data for the pool is stored after the decision.
export function isXcpNgPoolKept(
  decision: XcpNgPoolAssignmentDecision,
): boolean {
  return (
    decision === XcpNgPoolAssignmentDecision.Create ||
    decision === XcpNgPoolAssignmentDecision.Keep ||
    decision === XcpNgPoolAssignmentDecision.TakeOver
  );
}
