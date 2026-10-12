import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
  NetworkFlowCollectorPortsUtil,
} from "../../../Types/NetFlow/NetworkFlowCollectorPorts";
import NetworkFlowFormat, {
  NETWORK_FLOW_FORMATS,
  NetworkFlowFormatUtil,
} from "../../../Types/NetFlow/NetworkFlowFormat";
import { describe, expect, test } from "@jest/globals";

/*
 * The ports a probe's flow collector listens on, and the formats it names -
 * shared by the probe, the server and the dashboard's set-up steps.
 */

describe("NetworkFlowCollectorPortsUtil.getListeningPorts", () => {
  test("the defaults are the conventional ports, NetFlow then IPFIX then sFlow", () => {
    expect(DEFAULT_NETFLOW_COLLECTOR_PORT).toBe(2055);
    expect(DEFAULT_IPFIX_COLLECTOR_PORT).toBe(4739);
    expect(DEFAULT_SFLOW_COLLECTOR_PORT).toBe(6343);

    expect(
      NetworkFlowCollectorPortsUtil.getListeningPorts({
        netFlowPort: DEFAULT_NETFLOW_COLLECTOR_PORT,
        ipfixPort: DEFAULT_IPFIX_COLLECTOR_PORT,
        sFlowPort: DEFAULT_SFLOW_COLLECTOR_PORT,
      }),
    ).toEqual([2055, 4739, 6343]);
  });

  test("a port set to 0 is closed; one shared by two settings is listened on once", () => {
    expect(
      NetworkFlowCollectorPortsUtil.getListeningPorts({
        netFlowPort: 9995,
        ipfixPort: 0,
        sFlowPort: 9995,
      }),
    ).toEqual([9995]);
  });

  test("values that are not UDP ports are never listened on", () => {
    expect(
      NetworkFlowCollectorPortsUtil.getListeningPorts({
        netFlowPort: -1,
        ipfixPort: 70000,
        sFlowPort: 1.5,
      }),
    ).toEqual([]);
  });
});

describe("NetworkFlowFormat", () => {
  test("names the four formats as people do, in one order", () => {
    expect(NETWORK_FLOW_FORMATS).toEqual([
      "NetFlow v5",
      "NetFlow v9",
      "IPFIX",
      "sFlow",
    ]);
  });

  test("parses what a stored row holds, and nothing else", () => {
    expect(NetworkFlowFormatUtil.parse("IPFIX")).toBe(NetworkFlowFormat.Ipfix);
    expect(NetworkFlowFormatUtil.parse("sFlow")).toBe(NetworkFlowFormat.SFlow);
    expect(NetworkFlowFormatUtil.parse("ipfix")).toBeNull();
    expect(NetworkFlowFormatUtil.parse("NetFlow v8")).toBeNull();
    expect(NetworkFlowFormatUtil.parse(9)).toBeNull();
    expect(NetworkFlowFormatUtil.parse(undefined)).toBeNull();
  });

  test("sFlow always samples; the others only when told to", () => {
    expect(NetworkFlowFormatUtil.isAlwaysSampled(NetworkFlowFormat.SFlow)).toBe(
      true,
    );

    for (const format of [
      NetworkFlowFormat.NetFlowV5,
      NetworkFlowFormat.NetFlowV9,
      NetworkFlowFormat.Ipfix,
    ]) {
      expect(NetworkFlowFormatUtil.isAlwaysSampled(format)).toBe(false);
    }
  });
});
