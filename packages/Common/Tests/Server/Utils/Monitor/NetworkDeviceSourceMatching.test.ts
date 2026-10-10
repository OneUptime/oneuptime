import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../../Types/ObjectID";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Which devices a trap, a syslog message or a flow record belongs to, by the
 * address it came from (findDevicesByProbeAndSource), among the devices the
 * receiving probe polls:
 *
 *   1. hostname equal to the address (the fast, indexed lookup);
 *   2. hostname the same address in another spelling (IPv6);
 *   3. the address among the device's Other Addresses - a router that sends
 *      from its loopback, or from the interface facing the probe;
 *   4. hostname a DNS name that resolves to the address.
 *
 * In that order: what someone typed wins over what DNS says.
 */

const PROBE: ObjectID = ObjectID.generate();
const PROJECT: ObjectID = ObjectID.generate();

function device(
  hostname: string,
  otherAddresses?: string,
): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(ObjectID.generate());
  value.projectId = PROJECT;
  value.hostname = hostname;

  if (otherAddresses) {
    value.otherAddresses = otherAddresses;
  }

  return value;
}

type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

let findBy: MockFunction;
let resolve: MockFunction;

// First call: the exact hostname lookup. Second: every device on the probe.
function devicesOnProbe(
  exact: Array<NetworkDevice>,
  all: Array<NetworkDevice>,
): void {
  findBy
    .mockResolvedValueOnce(exact as never)
    .mockResolvedValueOnce(all as never);
}

beforeEach(() => {
  findBy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockResolvedValue([] as never) as unknown as MockFunction;

  resolve = jest
    .spyOn(
      (
        NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache }
      ).dnsCache,
      "resolve",
    )
    .mockResolvedValue([] as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function match(address: string): Promise<Array<NetworkDevice>> {
  return NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
    probeId: PROBE,
    sourceIpAddress: address,
  });
}

describe("matching a source address to the probe's devices", () => {
  test("a device whose hostname is the address is found by the exact lookup alone", async () => {
    const router: NetworkDevice = device("10.0.0.1");
    findBy.mockResolvedValueOnce([router] as never);

    expect(await match("10.0.0.1")).toEqual([router]);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("a device that lists the address among its Other Addresses is found", async () => {
    const router: NetworkDevice = device("10.0.0.1", "10.255.0.1, 192.168.1.1");
    devicesOnProbe([], [device("10.0.0.2"), router]);

    expect(await match("192.168.1.1")).toEqual([router]);

    // The scan asked for the column it matches on.
    const scan: { select: Record<string, boolean> } = findBy.mock
      .calls[1]![0] as { select: Record<string, boolean> };
    expect(scan.select["otherAddresses"]).toBe(true);
  });

  test("an IPv6 Other Address matches the datagram's spelling of it", async () => {
    const router: NetworkDevice = device("10.0.0.1", "2001:DB8:0:0::1");
    devicesOnProbe([], [router]);

    expect(await match("2001:db8::1")).toEqual([router]);
  });

  test("a hostname that is the address in another spelling wins over an Other Address", async () => {
    const byHostname: NetworkDevice = device("2001:DB8::1");
    const byOtherAddress: NetworkDevice = device("10.0.0.9", "2001:db8::1");
    devicesOnProbe([], [byOtherAddress, byHostname]);

    expect(await match("2001:db8::1")).toEqual([byHostname]);
  });

  test("an Other Address wins over a DNS name that also resolves to the address", async () => {
    const byOtherAddress: NetworkDevice = device("10.0.0.9", "10.255.0.1");
    const byDns: NetworkDevice = device("core.example.com");
    devicesOnProbe([], [byDns, byOtherAddress]);
    resolve.mockResolvedValue(["10.255.0.1"] as never);

    expect(await match("10.255.0.1")).toEqual([byOtherAddress]);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("with no Other Address, a DNS name that resolves to the address still matches", async () => {
    const byDns: NetworkDevice = device("core.example.com");
    devicesOnProbe([], [byDns]);
    resolve.mockResolvedValue(["10.255.0.1"] as never);

    expect(await match("10.255.0.1")).toEqual([byDns]);
  });

  test("a device with only Other Addresses and no hostname can still be matched", async () => {
    const unnamed: NetworkDevice = device("", "10.255.0.7");
    devicesOnProbe([], [unnamed]);

    expect(await match("10.255.0.7")).toEqual([unnamed]);
  });

  test("an address nobody has matches nobody", async () => {
    devicesOnProbe([], [device("10.0.0.1", "10.255.0.1")]);

    expect(await match("10.255.0.2")).toEqual([]);
  });
});
