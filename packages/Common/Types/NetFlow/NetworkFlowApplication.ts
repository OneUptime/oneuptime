/*
 * What traffic is FOR, read from its IP protocol and ports.
 *
 * Flow records carry a protocol number and two ports. People think in
 * applications - HTTPS, DNS, SSH - so the Traffic pages name the service a
 * conversation used, and the probe folds the port a client picked at random
 * (its ephemeral port) into 0, so that a thousand connections from one
 * laptop to one web server sum up as one record instead of a thousand.
 *
 * This is port-based naming, not deep packet inspection: traffic on a
 * well-known port is named after the service usually found there. That is
 * what the flow formats can tell, and the pages say "port" next to it.
 */

// IP protocols whose records carry source and destination ports.
const PORT_PROTOCOL_NUMBERS: ReadonlySet<number> = new Set<number>([
  6, // TCP
  17, // UDP
  33, // DCCP
  132, // SCTP
]);

export const TCP_PROTOCOL_NUMBER: number = 6;
export const UDP_PROTOCOL_NUMBER: number = 17;
export const ICMP_PROTOCOL_NUMBER: number = 1;
export const ICMPV6_PROTOCOL_NUMBER: number = 58;

// IANA protocol numbers people meet in practice; anything else shows its number.
const PROTOCOL_NAMES: Readonly<Record<number, string>> = {
  1: "ICMP",
  2: "IGMP",
  4: "IP-in-IP",
  6: "TCP",
  17: "UDP",
  33: "DCCP",
  41: "IPv6",
  47: "GRE",
  50: "ESP",
  51: "AH",
  58: "ICMPv6",
  88: "EIGRP",
  89: "OSPF",
  103: "PIM",
  112: "VRRP",
  115: "L2TP",
  132: "SCTP",
};

type ServiceTransport = "tcp" | "udp" | "both";

interface KnownService {
  port: number;
  name: string;
  transport: ServiceTransport;
}

/*
 * Well-known and widely used service ports. "both" means the name holds for
 * TCP and UDP; UDP 443 is QUIC (HTTP/3), so HTTPS is TCP only.
 */
const KNOWN_SERVICES: ReadonlyArray<KnownService> = [
  { port: 20, name: "FTP Data", transport: "tcp" },
  { port: 21, name: "FTP", transport: "tcp" },
  { port: 22, name: "SSH", transport: "tcp" },
  { port: 23, name: "Telnet", transport: "tcp" },
  { port: 25, name: "SMTP", transport: "tcp" },
  { port: 53, name: "DNS", transport: "both" },
  { port: 67, name: "DHCP", transport: "udp" },
  { port: 68, name: "DHCP", transport: "udp" },
  { port: 69, name: "TFTP", transport: "udp" },
  { port: 80, name: "HTTP", transport: "tcp" },
  { port: 88, name: "Kerberos", transport: "both" },
  { port: 110, name: "POP3", transport: "tcp" },
  { port: 123, name: "NTP", transport: "udp" },
  { port: 135, name: "Microsoft RPC", transport: "tcp" },
  { port: 137, name: "NetBIOS", transport: "udp" },
  { port: 138, name: "NetBIOS", transport: "udp" },
  { port: 139, name: "NetBIOS", transport: "tcp" },
  { port: 143, name: "IMAP", transport: "tcp" },
  { port: 161, name: "SNMP", transport: "udp" },
  { port: 162, name: "SNMP Trap", transport: "udp" },
  { port: 179, name: "BGP", transport: "tcp" },
  { port: 389, name: "LDAP", transport: "both" },
  { port: 443, name: "HTTPS", transport: "tcp" },
  { port: 443, name: "QUIC", transport: "udp" },
  { port: 445, name: "SMB", transport: "tcp" },
  { port: 465, name: "SMTPS", transport: "tcp" },
  { port: 500, name: "IPsec IKE", transport: "udp" },
  { port: 514, name: "Syslog", transport: "udp" },
  { port: 587, name: "SMTP Submission", transport: "tcp" },
  { port: 636, name: "LDAPS", transport: "tcp" },
  { port: 853, name: "DNS over TLS", transport: "tcp" },
  { port: 993, name: "IMAPS", transport: "tcp" },
  { port: 995, name: "POP3S", transport: "tcp" },
  { port: 1194, name: "OpenVPN", transport: "both" },
  { port: 1433, name: "SQL Server", transport: "tcp" },
  { port: 1521, name: "Oracle Database", transport: "tcp" },
  { port: 1701, name: "L2TP", transport: "udp" },
  { port: 1723, name: "PPTP", transport: "tcp" },
  { port: 1812, name: "RADIUS", transport: "udp" },
  { port: 1813, name: "RADIUS Accounting", transport: "udp" },
  { port: 1883, name: "MQTT", transport: "tcp" },
  { port: 2049, name: "NFS", transport: "both" },
  { port: 2055, name: "NetFlow", transport: "udp" },
  { port: 3306, name: "MySQL", transport: "tcp" },
  { port: 3389, name: "Remote Desktop", transport: "both" },
  { port: 3478, name: "STUN", transport: "both" },
  { port: 4500, name: "IPsec NAT-T", transport: "udp" },
  { port: 4739, name: "IPFIX", transport: "udp" },
  { port: 5060, name: "SIP", transport: "both" },
  { port: 5061, name: "SIP over TLS", transport: "tcp" },
  { port: 5222, name: "XMPP", transport: "tcp" },
  { port: 5353, name: "mDNS", transport: "udp" },
  { port: 5432, name: "PostgreSQL", transport: "tcp" },
  { port: 5672, name: "AMQP", transport: "tcp" },
  { port: 5900, name: "VNC", transport: "tcp" },
  { port: 6343, name: "sFlow", transport: "udp" },
  { port: 6379, name: "Redis", transport: "tcp" },
  { port: 6443, name: "Kubernetes API", transport: "tcp" },
  { port: 8080, name: "HTTP (8080)", transport: "tcp" },
  { port: 8443, name: "HTTPS (8443)", transport: "tcp" },
  { port: 9092, name: "Kafka", transport: "tcp" },
  { port: 9200, name: "Elasticsearch", transport: "tcp" },
  { port: 11211, name: "Memcached", transport: "both" },
  { port: 27017, name: "MongoDB", transport: "tcp" },
  { port: 51820, name: "WireGuard", transport: "udp" },
];

/*
 * The lowest port operating systems hand out as a client's ephemeral port:
 * Linux uses 32768-60999, Windows and the BSDs 49152-65535. A port at or
 * above it, facing a service, is the client's and says nothing about the
 * traffic.
 */
const EPHEMERAL_PORT_FLOOR: number = 32768;

// How strongly a port looks like a service port.
enum ServiceLikeness {
  None = 0, // port 0, or in the ephemeral range
  Registered = 1, // 1024-32767 and not a known service
  Service = 2, // a known service, or a well-known port (below 1024)
}

export interface NetworkFlowPorts {
  sourcePort: number;
  destinationPort: number;
}

/*
 * How to name traffic in a table: the service ("HTTPS") when the port is a
 * known one, the protocol name ("TCP", "GRE") and the port, or neither for a
 * protocol number nobody named. The dashboard turns the pieces into words.
 */
export interface NetworkFlowApplicationName {
  protocolNumber: number;
  // 0 when the protocol has no ports.
  port: number;
  // The service usually on this port, e.g. "HTTPS". Null when not a known one.
  serviceName: string | null;
  // The IP protocol's name, e.g. "TCP". Null when the number has no name here.
  protocolName: string | null;
}

export default class NetworkFlowApplicationUtil {
  public static hasPorts(protocolNumber: number): boolean {
    return PORT_PROTOCOL_NUMBERS.has(protocolNumber);
  }

  public static getProtocolName(protocolNumber: number): string | null {
    return PROTOCOL_NAMES[protocolNumber] || null;
  }

  // The service usually found on this protocol and port, or null.
  public static getServiceName(
    protocolNumber: number,
    port: number,
  ): string | null {
    if (!NetworkFlowApplicationUtil.hasPorts(protocolNumber) || port <= 0) {
      return null;
    }

    const transport: "tcp" | "udp" | null =
      protocolNumber === TCP_PROTOCOL_NUMBER
        ? "tcp"
        : protocolNumber === UDP_PROTOCOL_NUMBER
          ? "udp"
          : null;

    for (const service of KNOWN_SERVICES) {
      if (service.port !== port) {
        continue;
      }

      if (
        service.transport === "both" ||
        transport === null ||
        service.transport === transport
      ) {
        return service.name;
      }
    }

    return null;
  }

  public static isKnownServicePort(
    protocolNumber: number,
    port: number,
  ): boolean {
    return (
      NetworkFlowApplicationUtil.getServiceName(protocolNumber, port) !== null
    );
  }

  /*
   * Folds a client's ephemeral port into 0 when the other side of the
   * conversation is plainly the service: a known service or a well-known
   * port facing anything that is not, or a registered port facing the
   * ephemeral range. Two ports that look alike (both services, both
   * ephemeral, the same port) are left as they are - there is no telling
   * which side is the client.
   */
  public static foldEphemeralPort(
    protocolNumber: number,
    sourcePort: number,
    destinationPort: number,
  ): NetworkFlowPorts {
    if (
      !NetworkFlowApplicationUtil.hasPorts(protocolNumber) ||
      sourcePort === destinationPort ||
      sourcePort === 0 ||
      destinationPort === 0
    ) {
      return { sourcePort: sourcePort, destinationPort: destinationPort };
    }

    const sourceLikeness: ServiceLikeness =
      NetworkFlowApplicationUtil.getServiceLikeness(protocolNumber, sourcePort);
    const destinationLikeness: ServiceLikeness =
      NetworkFlowApplicationUtil.getServiceLikeness(
        protocolNumber,
        destinationPort,
      );

    if (
      destinationLikeness > sourceLikeness &&
      sourceLikeness <= ServiceLikeness.Registered
    ) {
      return { sourcePort: 0, destinationPort: destinationPort };
    }

    if (
      sourceLikeness > destinationLikeness &&
      destinationLikeness <= ServiceLikeness.Registered
    ) {
      return { sourcePort: sourcePort, destinationPort: 0 };
    }

    return { sourcePort: sourcePort, destinationPort: destinationPort };
  }

  /*
   * The port that names the service of a conversation: the side a client
   * folded away leaves the other; otherwise the more service-like port, and
   * on a tie the lower one. 0 for protocols without ports.
   *
   * The server groups stored rows the same way in SQL
   * (getServicePortSql): a folded side is 0, and the lower port wins.
   */
  public static getServicePort(
    protocolNumber: number,
    sourcePort: number,
    destinationPort: number,
  ): number {
    if (!NetworkFlowApplicationUtil.hasPorts(protocolNumber)) {
      return 0;
    }

    if (sourcePort === 0) {
      return destinationPort;
    }

    if (destinationPort === 0) {
      return sourcePort;
    }

    const sourceLikeness: ServiceLikeness =
      NetworkFlowApplicationUtil.getServiceLikeness(protocolNumber, sourcePort);
    const destinationLikeness: ServiceLikeness =
      NetworkFlowApplicationUtil.getServiceLikeness(
        protocolNumber,
        destinationPort,
      );

    if (sourceLikeness !== destinationLikeness) {
      return sourceLikeness > destinationLikeness
        ? sourcePort
        : destinationPort;
    }

    return Math.min(sourcePort, destinationPort);
  }

  public static getApplicationName(
    protocolNumber: number,
    port: number,
  ): NetworkFlowApplicationName {
    const hasPorts: boolean =
      NetworkFlowApplicationUtil.hasPorts(protocolNumber);

    return {
      protocolNumber: protocolNumber,
      port: hasPorts ? port : 0,
      serviceName: hasPorts
        ? NetworkFlowApplicationUtil.getServiceName(protocolNumber, port)
        : null,
      protocolName: NetworkFlowApplicationUtil.getProtocolName(protocolNumber),
    };
  }

  private static getServiceLikeness(
    protocolNumber: number,
    port: number,
  ): ServiceLikeness {
    if (port <= 0) {
      return ServiceLikeness.None;
    }

    if (
      port < 1024 ||
      NetworkFlowApplicationUtil.isKnownServicePort(protocolNumber, port)
    ) {
      return ServiceLikeness.Service;
    }

    if (port >= EPHEMERAL_PORT_FLOOR) {
      return ServiceLikeness.None;
    }

    return ServiceLikeness.Registered;
  }
}
