/*
 * One flow as a decoder read it off the wire, before the collector
 * normalizes it (NetworkFlowRecordNormalizer): the counts are what the
 * device reported, not yet scaled by its sampling rate, and both ports are
 * as the device saw them.
 *
 * Every decoder - NetFlow v5, NetFlow v9, IPFIX and sFlow - produces this
 * one shape, so everything after decoding treats the formats alike.
 */
export default interface DecodedFlowRecord {
  sourceIpAddress: string;
  destinationIpAddress: string;
  // SNMP ifIndex of the interface the traffic entered and left through; 0 = unknown.
  inputInterfaceIndex: number;
  outputInterfaceIndex: number;
  packets: number;
  octets: number;
  flowStartAt: Date;
  flowEndAt: Date;
  sourcePort: number;
  destinationPort: number;
  tcpFlags: number;
  protocolNumber: number;
  tos: number;
  /*
   * The device counted one packet in this many (1 = every packet). sFlow
   * always samples; NetFlow and IPFIX say so in their headers, in option
   * records or in the flow record itself.
   */
  samplingRate: number;
}
