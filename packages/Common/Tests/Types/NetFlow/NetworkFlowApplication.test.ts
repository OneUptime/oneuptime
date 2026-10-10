import NetworkFlowApplicationUtil, {
  NetworkFlowApplicationName,
} from "../../../Types/NetFlow/NetworkFlowApplication";
import { describe, expect, test } from "@jest/globals";

/*
 * Naming traffic by protocol and port, and folding a client's ephemeral
 * port away: the probe folds before it forwards, the server groups what is
 * stored by service port, and the Traffic pages name it - all with these
 * rules.
 */

const TCP: number = 6;
const UDP: number = 17;
const ICMP: number = 1;
const GRE: number = 47;
const SCTP: number = 132;

describe("NetworkFlowApplicationUtil.getServiceName", () => {
  test.each([
    [TCP, 443, "HTTPS"],
    [UDP, 443, "QUIC"],
    [TCP, 53, "DNS"],
    [UDP, 53, "DNS"],
    [TCP, 22, "SSH"],
    [TCP, 3389, "Remote Desktop"],
    [UDP, 3389, "Remote Desktop"],
    [UDP, 123, "NTP"],
    [TCP, 5432, "PostgreSQL"],
    [UDP, 51820, "WireGuard"],
    [UDP, 6343, "sFlow"],
    [UDP, 2055, "NetFlow"],
    [UDP, 4739, "IPFIX"],
    // SCTP is a port protocol; a name that holds for TCP stands for it too.
    [SCTP, 443, "HTTPS"],
  ])(
    "protocol %i port %i is %s",
    (protocol: number, port: number, name: string) => {
      expect(NetworkFlowApplicationUtil.getServiceName(protocol, port)).toBe(
        name,
      );
    },
  );

  test("a port nobody named, port 0 and protocols without ports have no service name", () => {
    expect(NetworkFlowApplicationUtil.getServiceName(TCP, 4444)).toBeNull();
    expect(NetworkFlowApplicationUtil.getServiceName(TCP, 0)).toBeNull();
    expect(NetworkFlowApplicationUtil.getServiceName(ICMP, 443)).toBeNull();
    expect(NetworkFlowApplicationUtil.getServiceName(GRE, 80)).toBeNull();
    // HTTPS is TCP; UDP 22 is not SSH.
    expect(NetworkFlowApplicationUtil.getServiceName(UDP, 22)).toBeNull();
  });
});

describe("NetworkFlowApplicationUtil.getProtocolName", () => {
  test("names the protocols people meet and leaves the rest to their number", () => {
    expect(NetworkFlowApplicationUtil.getProtocolName(TCP)).toBe("TCP");
    expect(NetworkFlowApplicationUtil.getProtocolName(UDP)).toBe("UDP");
    expect(NetworkFlowApplicationUtil.getProtocolName(ICMP)).toBe("ICMP");
    expect(NetworkFlowApplicationUtil.getProtocolName(58)).toBe("ICMPv6");
    expect(NetworkFlowApplicationUtil.getProtocolName(GRE)).toBe("GRE");
    expect(NetworkFlowApplicationUtil.getProtocolName(50)).toBe("ESP");
    expect(NetworkFlowApplicationUtil.getProtocolName(89)).toBe("OSPF");
    expect(NetworkFlowApplicationUtil.getProtocolName(253)).toBeNull();
  });
});

describe("NetworkFlowApplicationUtil.foldEphemeralPort", () => {
  test.each([
    // [protocol, source, destination, folded source, folded destination]
    ["a client to HTTPS", TCP, 51000, 443, 0, 443],
    ["HTTPS back to the client", TCP, 443, 51000, 443, 0],
    ["a Windows client to a well-known port", TCP, 60000, 25, 0, 25],
    ["an old client port to a known service", TCP, 20000, 443, 0, 443],
    ["a client to a known high service", TCP, 50123, 5432, 0, 5432],
    ["a registered port facing the ephemeral range", TCP, 8081, 45000, 8081, 0],
    ["DNS from a client", UDP, 53001, 53, 0, 53],
  ])(
    "%s: folds the client's port",
    (
      _name: string,
      protocol: number,
      source: number,
      destination: number,
      foldedSource: number,
      foldedDestination: number,
    ) => {
      expect(
        NetworkFlowApplicationUtil.foldEphemeralPort(
          protocol,
          source,
          destination,
        ),
      ).toEqual({
        sourcePort: foldedSource,
        destinationPort: foldedDestination,
      });
    },
  );

  test.each([
    ["two registered ports (an app's own protocol)", TCP, 5000, 5001],
    ["two known services (NTP to DNS)", UDP, 123, 53],
    ["the same port both ways (NTP)", UDP, 123, 123],
    ["two ephemeral ports (peer to peer)", UDP, 40000, 50000],
    ["a side already folded", TCP, 0, 443],
    ["ICMP's type and code", ICMP, 0, 2048],
    ["GRE", GRE, 1234, 5678],
  ])(
    "%s: keeps both ports",
    (_name: string, protocol: number, source: number, destination: number) => {
      expect(
        NetworkFlowApplicationUtil.foldEphemeralPort(
          protocol,
          source,
          destination,
        ),
      ).toEqual({ sourcePort: source, destinationPort: destination });
    },
  );
});

describe("NetworkFlowApplicationUtil.getServicePort", () => {
  test("is the side left after folding, else the more service-like port, else the lower", () => {
    expect(NetworkFlowApplicationUtil.getServicePort(TCP, 0, 443)).toBe(443);
    expect(NetworkFlowApplicationUtil.getServicePort(TCP, 443, 0)).toBe(443);
    expect(NetworkFlowApplicationUtil.getServicePort(TCP, 51000, 443)).toBe(
      443,
    );
    expect(NetworkFlowApplicationUtil.getServicePort(TCP, 8080, 3000)).toBe(
      8080,
    );
    expect(NetworkFlowApplicationUtil.getServicePort(TCP, 5001, 5000)).toBe(
      5000,
    );
    expect(NetworkFlowApplicationUtil.getServicePort(UDP, 123, 53)).toBe(53);
  });

  test("is 0 for protocols without ports, whatever their port fields hold", () => {
    expect(NetworkFlowApplicationUtil.getServicePort(ICMP, 0, 2048)).toBe(0);
    expect(NetworkFlowApplicationUtil.getServicePort(GRE, 1, 2)).toBe(0);
  });

  test("agrees with folding: folding never changes which port names the service", () => {
    const pairs: Array<[number, number, number]> = [
      [TCP, 51000, 443],
      [TCP, 443, 51000],
      [UDP, 53001, 53],
      [TCP, 8081, 45000],
      [TCP, 5000, 5001],
      [UDP, 123, 53],
    ];

    for (const [protocol, source, destination] of pairs) {
      const folded: { sourcePort: number; destinationPort: number } =
        NetworkFlowApplicationUtil.foldEphemeralPort(
          protocol,
          source,
          destination,
        );

      expect(
        NetworkFlowApplicationUtil.getServicePort(
          protocol,
          folded.sourcePort,
          folded.destinationPort,
        ),
      ).toBe(
        NetworkFlowApplicationUtil.getServicePort(
          protocol,
          source,
          destination,
        ),
      );
    }
  });
});

describe("NetworkFlowApplicationUtil.getApplicationName", () => {
  test("gives the service, the protocol and the port for the dashboard to word", () => {
    expect(NetworkFlowApplicationUtil.getApplicationName(TCP, 443)).toEqual({
      protocolNumber: TCP,
      port: 443,
      serviceName: "HTTPS",
      protocolName: "TCP",
    } as NetworkFlowApplicationName);

    expect(NetworkFlowApplicationUtil.getApplicationName(TCP, 4444)).toEqual({
      protocolNumber: TCP,
      port: 4444,
      serviceName: null,
      protocolName: "TCP",
    } as NetworkFlowApplicationName);
  });

  test("a protocol without ports carries no port", () => {
    expect(NetworkFlowApplicationUtil.getApplicationName(ICMP, 2048)).toEqual({
      protocolNumber: ICMP,
      port: 0,
      serviceName: null,
      protocolName: "ICMP",
    } as NetworkFlowApplicationName);

    expect(
      NetworkFlowApplicationUtil.getApplicationName(253, 0).protocolName,
    ).toBeNull();
  });
});
