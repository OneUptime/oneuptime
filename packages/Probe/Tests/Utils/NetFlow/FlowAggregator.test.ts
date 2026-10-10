import FlowAggregator from "../../../Utils/NetFlow/FlowAggregator";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import { describe, expect, test } from "@jest/globals";

/*
 * Summing the records of one conversation before they are forwarded: what
 * counts as the same conversation, what a sum keeps, and the bound that keeps
 * a collector that cannot forward from growing without limit.
 */

const START: number = Date.UTC(2026, 0, 1, 10, 0, 0);

function flow(overrides: Partial<NetworkFlowRecord> = {}): NetworkFlowRecord {
  return {
    exporterIpAddress: "10.0.0.1",
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    sourcePort: 0,
    destinationPort: 443,
    protocolNumber: 6,
    octets: 1000,
    packets: 10,
    flowStartAt: new Date(START),
    flowEndAt: new Date(START + 1000),
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 2,
    tcpFlags: 0x02,
    flowFormat: NetworkFlowFormat.NetFlowV9,
    samplingRate: 1,
    flowCount: 1,
    ...overrides,
  };
}

describe("FlowAggregator", () => {
  test("records of one conversation sum: bytes, packets, record count, the widest time span and every TCP flag", () => {
    const aggregator: FlowAggregator = new FlowAggregator(100);

    aggregator.add(flow());
    aggregator.add(
      flow({
        octets: 500,
        packets: 5,
        tcpFlags: 0x10,
        flowStartAt: new Date(START - 5000),
        flowEndAt: new Date(START + 500),
      }),
    );
    aggregator.add(
      flow({
        octets: 1,
        packets: 1,
        tcpFlags: 0x01,
        flowStartAt: new Date(START + 2000),
        flowEndAt: new Date(START + 9000),
        flowCount: 3,
      }),
    );

    expect(aggregator.size).toBe(1);

    const [summed]: Array<NetworkFlowRecord> = aggregator.drain(10);
    expect(summed!.octets).toBe(1501);
    expect(summed!.packets).toBe(16);
    expect(summed!.flowCount).toBe(5);
    expect(summed!.flowStartAt.getTime()).toBe(START - 5000);
    expect(summed!.flowEndAt.getTime()).toBe(START + 9000);
    expect(summed!.tcpFlags).toBe(0x13);
  });

  test.each([
    ["another exporter", { exporterIpAddress: "10.0.0.2" }],
    ["another format", { flowFormat: NetworkFlowFormat.SFlow }],
    ["another sampling rate", { samplingRate: 100 }],
    ["another source", { sourceIpAddress: "10.0.0.6" }],
    ["another destination", { destinationIpAddress: "198.51.100.21" }],
    ["another protocol", { protocolNumber: 17 }],
    ["another source port", { sourcePort: 8080 }],
    ["another destination port", { destinationPort: 80 }],
    ["another input interface", { inputInterfaceIndex: 9 }],
    ["another output interface", { outputInterfaceIndex: 9 }],
  ] as Array<[string, Partial<NetworkFlowRecord>]>)(
    "%s is another conversation",
    (_name: string, change: Partial<NetworkFlowRecord>) => {
      const aggregator: FlowAggregator = new FlowAggregator(100);

      aggregator.add(flow());
      aggregator.add(flow(change));

      expect(aggregator.size).toBe(2);
    },
  );

  test("adding never changes the record that was handed in", () => {
    const aggregator: FlowAggregator = new FlowAggregator(100);
    const first: NetworkFlowRecord = flow();

    aggregator.add(first);
    aggregator.add(flow());

    expect(first.octets).toBe(1000);
    expect(first.flowCount).toBe(1);
  });

  test("past its bound the OLDEST conversations go, and are counted once", () => {
    const aggregator: FlowAggregator = new FlowAggregator(2);

    aggregator.add(flow({ destinationPort: 1 }));
    aggregator.add(flow({ destinationPort: 2 }));
    aggregator.add(flow({ destinationPort: 3 }));
    // Adding to a conversation already held drops nothing.
    aggregator.add(flow({ destinationPort: 3 }));

    expect(aggregator.takeDroppedCount()).toBe(1);
    expect(aggregator.takeDroppedCount()).toBe(0);
    expect(
      aggregator.drain(10).map((record: NetworkFlowRecord) => {
        return record.destinationPort;
      }),
    ).toEqual([2, 3]);
  });

  test("drain takes at most `max`, oldest first, and leaves the rest", () => {
    const aggregator: FlowAggregator = new FlowAggregator(100);

    for (const port of [1, 2, 3, 4, 5]) {
      aggregator.add(flow({ destinationPort: port }));
    }

    expect(
      aggregator.drain(2).map((record: NetworkFlowRecord) => {
        return record.destinationPort;
      }),
    ).toEqual([1, 2]);
    expect(aggregator.size).toBe(3);

    aggregator.clear();
    expect(aggregator.size).toBe(0);
  });

  test("a record without a format, rate or interfaces keys the same as one with the defaults", () => {
    const aggregator: FlowAggregator = new FlowAggregator(100);

    aggregator.add(
      flow({
        flowFormat: undefined,
        samplingRate: undefined,
        inputInterfaceIndex: undefined,
        outputInterfaceIndex: undefined,
      }),
    );
    aggregator.add(
      flow({
        flowFormat: undefined,
        samplingRate: 1,
        inputInterfaceIndex: 0,
        outputInterfaceIndex: 0,
      }),
    );

    expect(aggregator.size).toBe(1);
  });
});
