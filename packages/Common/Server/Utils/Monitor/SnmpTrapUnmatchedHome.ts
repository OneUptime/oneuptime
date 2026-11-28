import Probe from "../../../Models/DatabaseModels/Probe";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import ProbeService from "../../Services/ProbeService";
import ObjectID from "../../../Types/ObjectID";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import { SnmpV3CredentialHolders } from "../../../Types/Probe/SnmpV3CredentialHolders";
import SnmpTrapDeviceSelection from "./SnmpTrapDeviceSelection";

/*
 * WHERE AN SNMP TRAP FROM AN ADDRESS NO DEVICE HAS IS KEPT (OneUptime
 * issues #11005, #11174).
 *
 * A trap from an address that is not a device yet is kept, as from an
 * unknown source - its event offers Add as device - in a project that can
 * be told it is theirs, and nowhere else:
 *
 *   - Received by a project's own probe: in that project, as it always has
 *     been. A project's probe is handed only its own project's SNMPv3
 *     users, so whatever signed it is that project's.
 *   - Received by a global probe: only an SNMPv3 trap the probe
 *     authenticated, in the one project whose credential signed it - a
 *     site's default credential profile, when it is a device not added to
 *     that site yet, or a device's own when it sends from an address of its
 *     own nobody listed - and only while that project uses the probe: has
 *     a device on it, or a site whose Default Probe it is. A credential two
 *     projects hold cannot say whose the trap is, and a v1, v2c or
 *     noAuthNoPriv trap carries nothing a sender could not make up: those
 *     are kept nowhere, as a global probe's have always been.
 *
 * And when one site's default credential signed it - a site of that project
 * whose Default Probe the probe is - the site, so Add as device files the
 * new device there: polled by that probe, with that profile, as its
 * neighbours are.
 */

export interface SnmpTrapUnmatchedHomeResult {
  projectId: ObjectID;
  siteId?: ObjectID | undefined;
}

/*
 * How long whether a project uses a probe, and which of its sites name it,
 * is kept: a device not added yet may send a trap a second.
 */
export const PROBE_USE_CACHE_TTL_MS: number = 60 * 1000;
const PROBE_USE_CACHE_MAX_ENTRIES: number = 10_000;

interface ProbeUse {
  isUsed: boolean;
  siteIds: Array<string>;
}

export default class SnmpTrapUnmatchedHome {
  private static probeUseCache: InMemoryTTLCache<ProbeUse> =
    new InMemoryTTLCache(PROBE_USE_CACHE_MAX_ENTRIES);

  public static async find(data: {
    probeId: ObjectID;
    trap: SnmpTrap;
  }): Promise<SnmpTrapUnmatchedHomeResult | null> {
    const signers: SnmpV3CredentialHolders | null =
      SnmpTrapDeviceSelection.getSigners(data.trap);

    const probe: Probe | null = await ProbeService.findOneById({
      id: data.probeId,
      select: {
        projectId: true,
        isGlobalProbe: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!probe) {
      return null;
    }

    let projectId: ObjectID | null = null;

    if (!probe.isGlobalProbe && probe.projectId) {
      projectId = probe.projectId;
    } else if (
      probe.isGlobalProbe &&
      signers &&
      signers.projectIds.length === 1
    ) {
      projectId = new ObjectID(signers.projectIds[0]!);
    }

    if (!projectId) {
      return null;
    }

    const signerSiteIds: Array<string> = signers?.siteIds || [];

    // A project's own probe, and no site to name: its project, read nothing more.
    if (!probe.isGlobalProbe && signerSiteIds.length === 0) {
      return { projectId: projectId };
    }

    const use: ProbeUse = await SnmpTrapUnmatchedHome.findProbeUse({
      probeId: data.probeId,
      projectId: projectId,
      siteIds: signerSiteIds,
    });

    // A global probe keeps a trap only for a project that uses it.
    if (probe.isGlobalProbe && !use.isUsed) {
      return null;
    }

    const home: SnmpTrapUnmatchedHomeResult = { projectId: projectId };

    if (use.siteIds.length === 1) {
      home.siteId = new ObjectID(use.siteIds[0]!);
    }

    return home;
  }

  // Forget every answer (tests).
  public static clearCache(): void {
    SnmpTrapUnmatchedHome.probeUseCache.clear();
  }

  private static async findProbeUse(data: {
    probeId: ObjectID;
    projectId: ObjectID;
    siteIds: Array<string>;
  }): Promise<ProbeUse> {
    const key: string = JSON.stringify([
      data.probeId.toString(),
      data.projectId.toString(),
      [...data.siteIds].sort(),
    ]);

    const cached: ProbeUse | undefined =
      SnmpTrapUnmatchedHome.probeUseCache.get(key);

    if (cached) {
      return cached;
    }

    const use: ProbeUse =
      await NetworkDeviceService.findProbeUseByProject(data);

    SnmpTrapUnmatchedHome.probeUseCache.set(key, use, PROBE_USE_CACHE_TTL_MS);

    return use;
  }
}
