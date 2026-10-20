import net from "net";

/*
 * PRIVATE NETWORK ADDRESSES.
 *
 * An address no visitor on the internet has: the private ranges of RFC 1918,
 * loopback, link-local, and IPv6 unique local. When OneUptime attributes a
 * request to one of these, the request came from inside a network - one of
 * OneUptime's own services, a container network's gateway, a Kubernetes
 * node, a proxy or a load balancer of the operator's, or a person on the
 * operator's own network.
 *
 * The limits on wrong keys never count such an address (WrongKeyLimit), and
 * the Health page says so when many people signed in from one
 * (InstanceHealth/SharedVisitorAddresses).
 *
 * An IPv4 address written as IPv6 (::ffff:10.0.0.1) is read as the IPv4
 * address it is. 6to4, NAT64 and Teredo addresses are not unwrapped: they
 * are not private.
 */
const PRIVATE_NETWORKS: net.BlockList = new net.BlockList();
PRIVATE_NETWORKS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NETWORKS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NETWORKS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_NETWORKS.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_NETWORKS.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_NETWORKS.addAddress("::1", "ipv6");
PRIVATE_NETWORKS.addSubnet("fc00::", 7, "ipv6");
PRIVATE_NETWORKS.addSubnet("fe80::", 10, "ipv6");

/*
 * Whether an address is a private network address. Anything that is not an
 * address ("unknown", the client every caller that cannot be placed shares,
 * a host name, an empty string) is not.
 */
export const isPrivateNetworkAddress: (address: string) => boolean = (
  address: string,
): boolean => {
  const text: string = typeof address === "string" ? address : "";

  // An IPv6 link-local address may carry its zone ("fe80::1%eth0").
  const bare: string = text.includes(":") ? text.split("%")[0] || "" : text;
  const family: number = net.isIP(bare);

  if (family === 4) {
    return PRIVATE_NETWORKS.check(bare, "ipv4");
  }

  if (family === 6) {
    return PRIVATE_NETWORKS.check(bare, "ipv6");
  }

  return false;
};

export default isPrivateNetworkAddress;
