/*
 * One network flow parsed from a NetFlow v5 record, forwarded by a probe's
 * NetFlow receiver to the server, where it is correlated to a NetworkDevice
 * by the EXPORTER's IP address (the router/switch that sent the datagram)
 * and written into the ClickHouse NetworkFlow table. Source/destination
 * describe the traffic itself; exporterIpAddress identifies the device that
 * observed it. Flow timestamps are converted to wall-clock time by the
 * probe from the datagram's sysUptime/unixSecs header fields.
 */
export default interface NetworkFlowRecord {
  exporterIpAddress: string;
  sourceIpAddress: string;
  destinationIpAddress: string;
  sourcePort: number;
  destinationPort: number;
  protocolNumber: number;
  octets: number;
  packets: number;
  flowStartAt: Date;
  flowEndAt: Date;
  inputInterfaceIndex?: number | undefined;
  outputInterfaceIndex?: number | undefined;
  tcpFlags?: number | undefined;
  tos?: number | undefined;
}
