import Probe from "../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeProbeKind from "../../../Types/Probe/OneUptimeProbeKind";
import ProbeInterfaceAddressesUtil from "../../../Types/Probe/ProbeInterfaceAddresses";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { IpWhitelist } from "../../EnvironmentConfig";
import ProbeService from "../../Services/ProbeService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * WHICH ADDRESSES ARE ONEUPTIME'S OWN PROBES' - one list, read by everything
 * that must know them (#10338, #10429):
 *
 *   - the blocklist never blocks them: a block of a probe's address would
 *     fail every check the probe makes (SecurityBlocklist/
 *     SecurityProtectedAddresses);
 *   - Security Events knows a probe's own polls, discovery sweeps and port
 *     checks in the project's network flows by them, and does not report
 *     them as scans (SecurityEvent/TelemetryScan/ProbeOwnTraffic).
 *
 * What the list holds:
 *
 *   - each of the project's probes: the address it checks in from, as
 *     OneUptime sees it (Probe.egressIpAddress), and the addresses on its
 *     own network interfaces, as it lists them when it checks in
 *     (Probe.interfaceIpAddresses) - a probe polls its LAN from those;
 *   - each of OneUptime's own probes, which belong to no project: the
 *     address it checks in from;
 *   - OneUptime Cloud's probe addresses: the IP_WHITELIST setting, each an
 *     address or a range.
 *
 * How far each is to be believed is the reader's to weigh. The address a
 * probe checks in from is what OneUptime saw; the setting is the instance
 * operator's; the interface addresses are what the probe says of itself,
 * which anyone holding its key could say. So the flow scan never sets
 * traffic aside for its address alone: it must also be what the probe is
 * set to do. The blocklist refuses a block of any of them, and names the
 * probe, so a person sees why.
 */

export { OneUptimeProbeKind };

export enum OneUptimeProbeAddressSource {
  // Where the probe checks in from, as OneUptime saw it.
  CheckIn = "check-in",
  // On the probe's own network interfaces, as it lists them.
  Interface = "interface",
  // The instance's IP_WHITELIST setting.
  Setting = "setting",
}

export interface OneUptimeProbeAddress {
  // An address, or a range (the setting may list one), written the one way.
  value: string;
  source: OneUptimeProbeAddressSource;
}

export interface OneUptimeProbe {
  kind: OneUptimeProbeKind;
  // Empty for OneUptime Cloud's setting, which is no one probe.
  probeId: string;
  name: string;
  // When it last checked in; null when not read, or never.
  lastAlive: Date | null;
  addresses: Array<OneUptimeProbeAddress>;
}

export interface OneUptimeProbeRead {
  probes: Array<OneUptimeProbe>;
  // False when there were more than the read's limit: the rest were not read.
  isComplete: boolean;
}

export const ONEUPTIME_CLOUD_PROBES_NAME: string = "OneUptime Cloud";

const ROOT: { isRoot: true } = { isRoot: true };

// The addresses or ranges a setting lists: comma- or space-separated.
function settingEntries(text: string | undefined | null): Array<string> {
  return (text || "")
    .split(",")
    .flatMap((part: string): Array<string> => {
      return part.split(" ");
    })
    .map((part: string): string => {
      return part.trim();
    })
    .filter(Boolean);
}

// A text column narrowed to the read's text, or to any value at all.
function textFilter(contains: string | null): unknown {
  return contains === null
    ? QueryHelper.notNull()
    : QueryHelper.search(contains);
}

/*
 * A probe's addresses, each once: the address it checks in from first,
 * then those on its interfaces.
 */
function addressesOf(probe: Probe): Array<OneUptimeProbeAddress> {
  const addresses: Array<OneUptimeProbeAddress> = [];
  const seen: Set<string> = new Set();

  const add: (value: unknown, source: OneUptimeProbeAddressSource) => void = (
    value: unknown,
    source: OneUptimeProbeAddressSource,
  ): void => {
    const address: string | null =
      NetworkAddressBlockUtil.canonicalAddress(value);

    if (address && !seen.has(address)) {
      seen.add(address);
      addresses.push({ value: address, source });
    }
  };

  add(probe.egressIpAddress, OneUptimeProbeAddressSource.CheckIn);

  for (const address of ProbeInterfaceAddressesUtil.fromText(
    probe.interfaceIpAddresses,
  )) {
    add(address, OneUptimeProbeAddressSource.Interface);
  }

  return addresses;
}

function toOneUptimeProbe(
  probe: Probe,
  kind: OneUptimeProbeKind,
): OneUptimeProbe {
  return {
    kind,
    probeId: probe.id?.toString() || "",
    name: probe.name || "",
    lastAlive: probe.lastAlive ? new Date(probe.lastAlive) : null,
    addresses: addressesOf(probe),
  };
}

export default class OneUptimeProbeAddresses {
  /*
   * The project's own probes that hold an address: by the address they
   * check in from, and by those on their interfaces - each one read once,
   * whichever matched. `contains` narrows the reads to probes holding an
   * address with that text (the blocklist's prefilter, held to the block
   * exactly afterwards); null reads every probe that holds one. Read as
   * `props`: a page lists only what its reader may read. `withLastAlive`
   * reads when each last checked in, for a reader that may read it.
   */
  public static async readProjectProbes(data: {
    projectId: ObjectID;
    contains: string | null;
    // The most probes kept; one more is read, to know whether that was all.
    limit: number;
    props: DatabaseCommonInteractionProps;
    withLastAlive?: boolean | undefined;
  }): Promise<OneUptimeProbeRead> {
    const select: {
      _id: true;
      name: true;
      egressIpAddress: true;
      interfaceIpAddresses: true;
      lastAlive?: true;
    } = {
      _id: true,
      name: true,
      egressIpAddress: true,
      interfaceIpAddresses: true,
      ...(data.withLastAlive ? { lastAlive: true as const } : {}),
    };

    const [byCheckIn, byInterface]: [Array<Probe>, Array<Probe>] =
      await Promise.all([
        ProbeService.findBy({
          query: {
            projectId: data.projectId,
            egressIpAddress: textFilter(data.contains) as never,
          },
          select,
          skip: 0,
          limit: data.limit + 1,
          props: data.props,
        }),
        ProbeService.findBy({
          query: {
            projectId: data.projectId,
            interfaceIpAddresses: textFilter(data.contains) as never,
          },
          select,
          skip: 0,
          limit: data.limit + 1,
          props: data.props,
        }),
      ]);

    const probes: Array<OneUptimeProbe> = [];
    const seen: Set<string> = new Set();

    for (const probe of [...byCheckIn, ...byInterface]) {
      const id: string = probe.id?.toString() || "";

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);

      const read: OneUptimeProbe = toOneUptimeProbe(
        probe,
        OneUptimeProbeKind.Project,
      );

      if (read.addresses.length > 0) {
        probes.push(read);
      }
    }

    return {
      probes: probes.slice(0, data.limit),
      isComplete:
        byCheckIn.length <= data.limit &&
        byInterface.length <= data.limit &&
        probes.length <= data.limit,
    };
  }

  /*
   * OneUptime's own probes, which belong to no project, by the address each
   * checks in from: read as OneUptime, as the IP addresses page lists them,
   * whoever asks. A global probe keeps no interface addresses: its network
   * is OneUptime's own, which no project's flows see.
   */
  public static async readGlobalProbes(data: {
    contains: string | null;
    limit: number;
    withLastAlive?: boolean | undefined;
  }): Promise<OneUptimeProbeRead> {
    const rows: Array<Probe> = await ProbeService.findBy({
      query: {
        isGlobalProbe: true,
        egressIpAddress: textFilter(data.contains) as never,
      },
      select: {
        _id: true,
        name: true,
        egressIpAddress: true,
        ...(data.withLastAlive ? { lastAlive: true as const } : {}),
      },
      skip: 0,
      limit: data.limit + 1,
      props: ROOT,
    });

    return {
      probes: rows
        .slice(0, data.limit)
        .map((probe: Probe): OneUptimeProbe => {
          return toOneUptimeProbe(probe, OneUptimeProbeKind.Global);
        })
        .filter((probe: OneUptimeProbe): boolean => {
          return probe.addresses.length > 0;
        }),
      isComplete: rows.length <= data.limit,
    };
  }

  /*
   * OneUptime Cloud's probe addresses: the IP_WHITELIST setting, each an
   * address or a range, written the one way blocks are. Null when the
   * setting lists none.
   */
  public static getOneUptimeCloud(
    setting: string = IpWhitelist,
  ): OneUptimeProbe | null {
    const addresses: Array<OneUptimeProbeAddress> = [];
    const seen: Set<string> = new Set();

    for (const entry of settingEntries(setting)) {
      const block: NetworkAddressBlock | null =
        NetworkAddressBlockUtil.parse(entry);

      if (block && !seen.has(block.text)) {
        seen.add(block.text);
        addresses.push({
          value: block.text,
          source: OneUptimeProbeAddressSource.Setting,
        });
      }
    }

    if (addresses.length === 0) {
      return null;
    }

    return {
      kind: OneUptimeProbeKind.OneUptimeCloud,
      probeId: "",
      name: ONEUPTIME_CLOUD_PROBES_NAME,
      lastAlive: null,
      addresses,
    };
  }
}
