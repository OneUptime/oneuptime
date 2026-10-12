/*
 * How a device described the traffic it saw: the flow export format the
 * probe decoded a record from. Kept on every stored flow (NetworkFlow
 * .flowFormat) so the Traffic pages can say what a device sends, and so a
 * sampled format is never mistaken for an exact count.
 *
 * The values are what people call the formats, and what the dashboard
 * shows: they are never translated.
 */
enum NetworkFlowFormat {
  NetFlowV5 = "NetFlow v5",
  NetFlowV9 = "NetFlow v9",
  Ipfix = "IPFIX",
  SFlow = "sFlow",
}

export const NETWORK_FLOW_FORMATS: ReadonlyArray<NetworkFlowFormat> = [
  NetworkFlowFormat.NetFlowV5,
  NetworkFlowFormat.NetFlowV9,
  NetworkFlowFormat.Ipfix,
  NetworkFlowFormat.SFlow,
];

export class NetworkFlowFormatUtil {
  // The format a stored value names, or null for anything else.
  public static parse(value: unknown): NetworkFlowFormat | null {
    if (typeof value !== "string") {
      return null;
    }

    for (const format of NETWORK_FLOW_FORMATS) {
      if (format === value) {
        return format;
      }
    }

    return null;
  }

  /*
   * sFlow samples packets by design: every sFlow record stands for many
   * packets. The NetFlow formats and IPFIX count every packet unless the
   * device was told to sample.
   */
  public static isAlwaysSampled(format: NetworkFlowFormat): boolean {
    return format === NetworkFlowFormat.SFlow;
  }
}

export default NetworkFlowFormat;
