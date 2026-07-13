/*
 * A derived view of the network topology for one project, built server-side
 * from the LLDP neighbor data each device reports. Nodes are devices;
 * unmanaged neighbors (LLDP peers with no matching NetworkDevice) appear as
 * lightweight nodes so the graph doesn't dead-end. Edges are LLDP links.
 */
export type NetworkTopologyNodeStatus = "up" | "down" | "unknown";

export interface NetworkTopologyNode {
  // Device id for managed nodes; a synthetic "unmanaged:<key>" id otherwise.
  id: string;
  name: string;
  isManaged: boolean;
  status: NetworkTopologyNodeStatus;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
}

export interface NetworkTopologyEdge {
  fromNodeId: string;
  toNodeId: string;
  fromPort?: string | undefined;
  toPort?: string | undefined;
}

export default interface NetworkTopology {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
}
