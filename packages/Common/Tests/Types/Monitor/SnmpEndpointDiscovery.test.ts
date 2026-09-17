import ArpEntry from "../../../Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "../../../Types/Monitor/SnmpMonitor/FdbEntry";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * These types travel over the probe ingest wire and get stored in JSON
 * columns, so a plain JSON round trip must preserve them exactly — no
 * class instances, no Dates, no methods.
 */
describe("SNMP endpoint discovery types", () => {
  describe("SnmpMonitorResponse with endpoint data", () => {
    test("arp and fdb entries survive a JSON wire round trip", () => {
      const arpEntry: ArpEntry = {
        ipAddress: "10.20.30.40",
        macAddress: "aa:bb:cc:dd:ee:ff",
        interfaceIndex: 3,
        entryType: "dynamic",
      };
      const fdbEntry: FdbEntry = {
        macAddress: "aa:bb:cc:dd:ee:ff",
        bridgePort: 7,
        interfaceIndex: 3,
        vlanId: 120,
        status: "learned",
      };
      const response: SnmpMonitorResponse = {
        isOnline: true,
        responseTimeInMs: 12,
        failureCause: "",
        oidResponses: [],
        arpEntries: [arpEntry],
        fdbEntries: [fdbEntry],
      };

      const roundTripped: SnmpMonitorResponse = JSON.parse(
        JSON.stringify(response),
      ) as SnmpMonitorResponse;

      expect(roundTripped.arpEntries).toEqual([arpEntry]);
      expect(roundTripped.fdbEntries).toEqual([fdbEntry]);
    });

    test("an older probe's payload carries no endpoint keys at all", () => {
      const response: SnmpMonitorResponse = {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: "Timed out",
        oidResponses: [],
      };

      /*
       * The server branches on presence, not emptiness (an absent array
       * means "this probe does not collect endpoints", an empty one means
       * "collected, found nothing"), so the wire form must not gain the
       * keys — JSON.stringify has to drop them rather than emit [].
       */
      const roundTripped: SnmpMonitorResponse = JSON.parse(
        JSON.stringify(response),
      ) as SnmpMonitorResponse;

      expect(Object.keys(roundTripped)).toEqual([
        "isOnline",
        "responseTimeInMs",
        "failureCause",
        "oidResponses",
      ]);
      expect("arpEntries" in roundTripped).toBe(false);
      expect("fdbEntries" in roundTripped).toBe(false);
    });

    test("entries carry only their required fields over the wire", () => {
      const arpEntry: ArpEntry = {
        ipAddress: "10.0.0.1",
        macAddress: "00:11:22:33:44:55",
        interfaceIndex: 1,
      };
      const fdbEntry: FdbEntry = {
        macAddress: "00:11:22:33:44:55",
        bridgePort: 2,
      };

      expect(Object.keys(JSON.parse(JSON.stringify(arpEntry)))).toEqual([
        "ipAddress",
        "macAddress",
        "interfaceIndex",
      ]);
      expect(Object.keys(JSON.parse(JSON.stringify(fdbEntry)))).toEqual([
        "macAddress",
        "bridgePort",
      ]);
    });
  });

  describe("NetworkTopology endpoint nodes and fdb links", () => {
    test("an endpoint node attached via an fdb edge round-trips", () => {
      const endpointNode: NetworkTopologyNode = {
        id: "endpoint:aa:bb:cc:dd:ee:ff",
        name: "POS Terminal 3",
        isManaged: false,
        status: "up",
        kind: "endpoint",
        macAddress: "aa:bb:cc:dd:ee:ff",
        ipAddress: "10.20.30.40",
        vendor: "Verifone",
        classification: "pos-terminal",
      };
      const edge: NetworkTopologyEdge = {
        fromNodeId: "device-1",
        toNodeId: endpointNode.id,
        protocols: ["fdb"],
      };
      const topology: NetworkTopology = {
        nodes: [endpointNode],
        edges: [edge],
      };

      const roundTripped: NetworkTopology = JSON.parse(
        JSON.stringify(topology),
      ) as NetworkTopology;

      expect(roundTripped).toEqual(topology);
      expect(roundTripped.nodes[0]!.kind).toBe("endpoint");
      expect(roundTripped.edges[0]!.protocols).toEqual(["fdb"]);
    });

    test("a legacy node round-trips without gaining endpoint keys", () => {
      const legacyNode: NetworkTopologyNode = {
        id: "device-1",
        name: "core-switch",
        isManaged: true,
        status: "up",
      };

      const roundTripped: NetworkTopologyNode = JSON.parse(
        JSON.stringify(legacyNode),
      ) as NetworkTopologyNode;

      expect(Object.keys(roundTripped)).toEqual([
        "id",
        "name",
        "isManaged",
        "status",
      ]);
      expect(roundTripped).toEqual(legacyNode);
    });
  });
});
