import FlowDatagramDecoder, {
  FlowDatagramOutcome,
  FlowDatagramResult,
} from "../../../Utils/NetFlow/FlowDatagramDecoder";
import NetworkFlowFormat from "Common/Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * What real flow exporters send, decoded end to end.
 *
 * Each fixture (Fixtures/README.md) is the datagrams softflowd or pmacct
 * sent for one short, invented capture: a TCP download from
 * 198.51.100.20:443 to 10.0.0.5, three DNS lookups, an IPv6 HTTPS exchange,
 * four pings, a VLAN-tagged UDP stream and an SSH session - 83 packets,
 * 57,224 bytes of IP traffic. Every exporter saw the same traffic, so every
 * fixture must decode to it: every packet counted unsampled, an estimate
 * close to it sampled.
 *
 * The addresses, ports, protocols, byte and packet counts below were checked
 * against goflow2 v2.2.3 decoding the same datagrams (the README says where,
 * and why, the probe reads more than goflow2 does).
 */

const FIXTURES: string = path.join(__dirname, "Fixtures");

// The capture the fixtures were made from (Fixtures/Generate/make-pcap.js).
const CAPTURE_PACKETS: number = 83;
const CAPTURE_IP_BYTES: number = 57224;

// sFlow reports Ethernet frame lengths: the IP bytes plus each frame's header.
const CAPTURE_FRAME_BYTES_SAMPLED_BY_PMACCT: number = 58596;

const EXPORTER: { address: string; port: number } = {
  address: "192.0.2.1",
  port: 50000,
};

// sFlow carries no wall clock: a sample is stamped when it arrives.
const RECEIVED_AT_MS: number = Date.UTC(2026, 0, 1, 0, 1, 40);

interface DecodedFixture {
  results: Array<FlowDatagramResult>;
  records: Array<NetworkFlowRecord>;
}

function decodeFixture(name: string): DecodedFixture {
  const decoder: FlowDatagramDecoder = new FlowDatagramDecoder({
    now: (): number => {
      return RECEIVED_AT_MS;
    },
  });

  const results: Array<FlowDatagramResult> = fs
    .readFileSync(path.join(FIXTURES, `${name}.hex`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line: string): FlowDatagramResult => {
      return decoder.decode(Buffer.from(line, "hex"), EXPORTER);
    });

  return {
    results: results,
    records: results.flatMap(
      (result: FlowDatagramResult): Array<NetworkFlowRecord> => {
        return result.records;
      },
    ),
  };
}

function sum(
  records: Array<NetworkFlowRecord>,
  field: "octets" | "packets",
): number {
  return records.reduce((total: number, record: NetworkFlowRecord): number => {
    return total + record[field];
  }, 0);
}

function find(
  records: Array<NetworkFlowRecord>,
  match: Partial<NetworkFlowRecord>,
): Array<NetworkFlowRecord> {
  return records.filter((record: NetworkFlowRecord): boolean => {
    return Object.entries(match).every(([key, value]: [string, unknown]) => {
      return (record as unknown as Record<string, unknown>)[key] === value;
    });
  });
}

describe("real exporters, decoded end to end", () => {
  test.each([
    ["softflowd-v5", NetworkFlowFormat.NetFlowV5],
    ["softflowd-v9", NetworkFlowFormat.NetFlowV9],
    ["softflowd-v9-sampled", NetworkFlowFormat.NetFlowV9],
    ["softflowd-ipfix", NetworkFlowFormat.Ipfix],
    ["softflowd-ipfix-sampled", NetworkFlowFormat.Ipfix],
    ["pmacct-v9-sampled", NetworkFlowFormat.NetFlowV9],
    ["pmacct-ipfix-sampled", NetworkFlowFormat.Ipfix],
    ["pmacct-sflow", NetworkFlowFormat.SFlow],
    ["pmacct-sflow-sampled", NetworkFlowFormat.SFlow],
  ] as Array<[string, NetworkFlowFormat]>)(
    "%s decodes as %s, every datagram, with nothing left over",
    (name: string, format: NetworkFlowFormat) => {
      const decoded: DecodedFixture = decodeFixture(name);

      expect(decoded.results.length).toBeGreaterThan(0);

      for (const result of decoded.results) {
        expect(result.outcome).toBe(FlowDatagramOutcome.Decoded);
        expect(result.format).toBe(format);
        // No data waited for a template: every exporter sent them first.
        expect(result.dataSetsWaitingForTemplate).toBe(0);
      }

      expect(decoded.records.length).toBeGreaterThan(0);

      for (const record of decoded.records) {
        expect(record.flowFormat).toBe(format);
        expect(record.flowCount).toBe(1);
        expect(record.octets).toBeGreaterThan(0);
        expect(record.packets).toBeGreaterThan(0);
      }
    },
  );

  test("unsampled NetFlow v9 and IPFIX count every packet and byte of the capture", () => {
    for (const name of ["softflowd-v9", "softflowd-ipfix"]) {
      const records: Array<NetworkFlowRecord> = decodeFixture(name).records;

      expect(records).toHaveLength(15);
      expect(sum(records, "packets")).toBe(CAPTURE_PACKETS);
      expect(sum(records, "octets")).toBe(CAPTURE_IP_BYTES);

      for (const record of records) {
        expect(record.samplingRate).toBe(1);
      }
    }
  });

  test("NetFlow v5 has no IPv6, so the IPv6 exchange is the only thing missing", () => {
    const records: Array<NetworkFlowRecord> =
      decodeFixture("softflowd-v5").records;

    expect(records).toHaveLength(13);
    // 12 IPv6 packets of 2,160 + 7,560 bytes are not in a v5 export.
    expect(sum(records, "packets")).toBe(CAPTURE_PACKETS - 12);
    expect(sum(records, "octets")).toBe(CAPTURE_IP_BYTES - 2160 - 7560);

    for (const record of records) {
      expect(record.sourceIpAddress).not.toContain(":");
      expect(record.destinationIpAddress).not.toContain(":");
    }
  });

  test("the download reads the same in every unsampled flow format", () => {
    for (const name of ["softflowd-v5", "softflowd-v9", "softflowd-ipfix"]) {
      const download: Array<NetworkFlowRecord> = find(
        decodeFixture(name).records,
        {
          sourceIpAddress: "198.51.100.20",
          destinationIpAddress: "10.0.0.5",
          protocolNumber: 6,
        },
      );

      expect(download).toHaveLength(1);
      expect(download[0]!.octets).toBe(34600);
      expect(download[0]!.packets).toBe(25);
      // The server's port stays; the client's ephemeral 51000 is folded away.
      expect(download[0]!.sourcePort).toBe(443);
      expect(download[0]!.destinationPort).toBe(0);
      // SYN-ACK, PSH and ACK were all seen.
      expect(download[0]!.tcpFlags).toBe(0x1a);
    }
  });

  test("a VLAN-tagged stream between two registered ports keeps both ports", () => {
    for (const name of ["softflowd-v9", "softflowd-ipfix", "pmacct-sflow"]) {
      const stream: Array<NetworkFlowRecord> = find(
        decodeFixture(name).records,
        { sourceIpAddress: "10.0.10.7", destinationIpAddress: "10.0.20.8" },
      );

      expect(stream.length).toBeGreaterThan(0);

      for (const record of stream) {
        expect(record.protocolNumber).toBe(17);
        expect(record.sourcePort).toBe(5000);
        expect(record.destinationPort).toBe(5001);
      }
    }
  });

  test("IPv6 addresses come out in their standard short form", () => {
    const records: Array<NetworkFlowRecord> =
      decodeFixture("softflowd-ipfix").records;
    const ipv6: Array<NetworkFlowRecord> = find(records, {
      sourceIpAddress: "2001:db8:20::443",
      destinationIpAddress: "2001:db8:10::5",
    });

    expect(ipv6).toHaveLength(1);
    expect(ipv6[0]!.octets).toBe(7560);
    expect(ipv6[0]!.packets).toBe(6);
    expect(ipv6[0]!.sourcePort).toBe(443);
  });

  test("softflowd's v9 sampling (an option record scoped to an interface) doubles every count", () => {
    const records: Array<NetworkFlowRecord> = decodeFixture(
      "softflowd-v9-sampled",
    ).records;

    expect(records).toHaveLength(9);

    for (const record of records) {
      expect(record.samplingRate).toBe(2);
      expect(record.packets % 2).toBe(0);
    }

    // 42 sampled packets stand for 84: close to the capture's 83.
    expect(sum(records, "packets")).toBe(84);
    expect(sum(records, "octets")).toBe(63064);
  });

  test("softflowd's IPFIX sampling (packet interval 1, space 1) is 1 in 2", () => {
    const records: Array<NetworkFlowRecord> = decodeFixture(
      "softflowd-ipfix-sampled",
    ).records;

    expect(records).toHaveLength(9);

    for (const record of records) {
      expect(record.samplingRate).toBe(2);
    }

    expect(sum(records, "packets")).toBe(84);
  });

  test("pmacct names its sampler in every v9 and IPFIX record: 1 in 10", () => {
    for (const name of ["pmacct-v9-sampled", "pmacct-ipfix-sampled"]) {
      const records: Array<NetworkFlowRecord> = decodeFixture(name).records;

      for (const record of records) {
        expect(record.samplingRate).toBe(10);
        expect(record.packets % 10).toBe(0);
      }
    }

    const v9: Array<NetworkFlowRecord> =
      decodeFixture("pmacct-v9-sampled").records;
    expect(sum(v9, "packets")).toBe(80);
    expect(sum(v9, "octets")).toBe(71960);
  });

  test("pmacct's absolute millisecond timestamps are the capture's own times", () => {
    const records: Array<NetworkFlowRecord> =
      decodeFixture("pmacct-v9-sampled").records;

    const download: NetworkFlowRecord = find(records, {
      sourceIpAddress: "198.51.100.20",
    })[0]!;

    expect(download.flowStartAt.toISOString()).toBe(
      "2026-01-01T00:00:00.220Z",
    );
    expect(download.flowEndAt.toISOString()).toBe("2026-01-01T00:00:00.780Z");

    for (const record of records) {
      expect(record.flowStartAt.getTime()).toBeGreaterThanOrEqual(
        Date.UTC(2026, 0, 1),
      );
      expect(record.flowEndAt.getTime()).toBeGreaterThanOrEqual(
        record.flowStartAt.getTime(),
      );
    }
  });

  test("softflowd's IPFIX uptimes are turned into wall clock with the boot time its option record gives", () => {
    const records: Array<NetworkFlowRecord> =
      decodeFixture("softflowd-ipfix").records;

    // Every flow lands at or before the export, never at the epoch.
    for (const record of records) {
      expect(record.flowStartAt.getTime()).toBeGreaterThan(
        Date.UTC(2026, 0, 1),
      );
      expect(record.flowEndAt.getTime()).toBeGreaterThanOrEqual(
        record.flowStartAt.getTime(),
      );
    }
  });

  test("sFlow names the device by its agent address, not by where the datagram came from", () => {
    for (const name of ["pmacct-sflow", "pmacct-sflow-sampled"]) {
      const decoded: DecodedFixture = decodeFixture(name);

      for (const result of decoded.results) {
        expect(result.exporterAddress).toBe("192.0.2.10");
      }

      for (const record of decoded.records) {
        expect(record.exporterIpAddress).toBe("192.0.2.10");
      }
    }
  });

  test("unsampled sFlow: one sample per packet, each the length of its frame", () => {
    const records: Array<NetworkFlowRecord> =
      decodeFixture("pmacct-sflow").records;

    expect(records).toHaveLength(82);
    expect(sum(records, "packets")).toBe(82);
    expect(sum(records, "octets")).toBe(CAPTURE_FRAME_BYTES_SAMPLED_BY_PMACCT);

    for (const record of records) {
      expect(record.samplingRate).toBe(1);
      expect(record.flowStartAt.getTime()).toBe(RECEIVED_AT_MS);
      // pmacct does not know the interfaces; "unknown" is 0, not 0x3fffffff.
      expect(record.inputInterfaceIndex).toBe(0);
      expect(record.outputInterfaceIndex).toBe(0);
    }
  });

  test("sampled sFlow: each sample stands for 4 packets and 4 times its bytes", () => {
    const records: Array<NetworkFlowRecord> = decodeFixture(
      "pmacct-sflow-sampled",
    ).records;

    expect(records).toHaveLength(19);

    for (const record of records) {
      expect(record.samplingRate).toBe(4);
      expect(record.packets).toBe(4);
      expect(record.octets % 4).toBe(0);
    }

    expect(sum(records, "packets")).toBe(76);
    expect(sum(records, "octets")).toBe(53736);
  });

  test("the exporter of NetFlow and IPFIX is where the datagram came from", () => {
    for (const name of ["softflowd-v5", "softflowd-v9", "pmacct-ipfix-sampled"]) {
      for (const record of decodeFixture(name).records) {
        expect(record.exporterIpAddress).toBe(EXPORTER.address);
      }
    }
  });
});
