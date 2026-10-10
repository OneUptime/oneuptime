import NetworkFlowFormat from "./NetworkFlowFormat";

/*
 * One network flow as a probe's flow collector forwards it to the server:
 * decoded from NetFlow v5, NetFlow v9, IPFIX or sFlow, and normalized into
 * this one shape whatever the device sent. The server matches it to a
 * Network Device by the EXPORTER's address (the router or switch that
 * reported it) and writes it into the ClickHouse NetworkFlow table. Source
 * and destination describe the traffic itself; exporterIpAddress names the
 * device that observed it. Flow times are wall clock: the probe converts
 * device uptime timestamps with the export header.
 *
 * Counts are ESTIMATES of the real traffic: a device that samples (sFlow
 * always does, NetFlow and IPFIX when told to) reports one packet in N, so
 * the probe multiplies its octets and packets by N and says so in
 * samplingRate.
 */
export default interface NetworkFlowRecord {
  exporterIpAddress: string;
  sourceIpAddress: string;
  destinationIpAddress: string;
  /*
   * 0 when the protocol has no ports, and on the client side of a
   * conversation with a service: the probe folds the ephemeral port a
   * client picked into 0 so that every connection to the same service
   * sums up as one record (NetworkFlowApplicationUtil.foldEphemeralPort).
   */
  sourcePort: number;
  destinationPort: number;
  protocolNumber: number;
  // Estimated bytes: what the device reported, times samplingRate.
  octets: number;
  // Estimated packets: what the device reported, times samplingRate.
  packets: number;
  flowStartAt: Date;
  flowEndAt: Date;
  inputInterfaceIndex?: number | undefined;
  outputInterfaceIndex?: number | undefined;
  tcpFlags?: number | undefined;
  tos?: number | undefined;
  /*
   * The format the device exported. A probe older than IPFIX and sFlow
   * support sends none (it only decoded NetFlow v5 and v9).
   */
  flowFormat?: NetworkFlowFormat | undefined;
  /*
   * The device sampled one packet in this many; 1 (or missing) means it
   * reported every packet.
   */
  samplingRate?: number | undefined;
  /*
   * How many records the device sent for this conversation that the probe
   * summed into this one (records of the same conversation arriving within
   * seconds of each other). Missing means 1.
   */
  flowCount?: number | undefined;
}
