import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import XcpNgConnectionType from "../../Types/XcpNg/XcpNgConnectionType";
import XcpNgCollectionSettings from "./XcpNgCollectionSettings";

/*
 * WHY NO PROBE READS AN XCP-NG CONNECTION, FROM THE CONNECTION'S OWN ROW - BY
 * THE RULE THE PROBES' CLAIM HANDS CONNECTIONS OUT BY.
 *
 * The claim (Server/Utils/XcpNg/XcpNgProbeCollectionStore, claimDueConnections
 * and getCollectableSql) hands a probe a connection that has an address and
 * the secrets its kind needs - a Xen Orchestra's OpenMetrics secret, a pool's
 * user name and password - and names that probe, which is the project's own,
 * or one of the instance's own on a self-hosted instance. Any other
 * connection it sets aside a quarter of an hour at a time, so its
 * nextCollectionAt keeps moving and its last status would read as current
 * for good, as a vCenter's did (OneUptime issue #8042). A probe that is
 * disconnected asks for nothing, whatever the claim would hand it.
 *
 * The project's being served (paid, not blocked) is the claim's rule too,
 * but a page in a project nobody may use is not shown, so it is not here.
 *
 * Keep this in step with the claim: XcpNgCollectionStop's test reads the
 * claim's conditions and fails on one this does not know.
 */

export enum XcpNgCollectionStop {
  NoAddress = "NoAddress",
  // Xen Orchestra: no OpenMetrics secret saved.
  NoSecret = "NoSecret",
  // XAPI: no user name, or no password saved.
  NoUserName = "NoUserName",
  NoPassword = "NoPassword",
  // No probe is named to read it: the claim reads connections by their probe.
  NoProbe = "NoProbe",
  // A shared probe on OneUptime Cloud, or another project's.
  ProbeNotAllowed = "ProbeNotAllowed",
  ProbeDisconnected = "ProbeDisconnected",
}

export interface XcpNgCollectionStopFacts {
  projectId?: { toString: () => string } | string | null | undefined;
  connectionType?: XcpNgConnectionType | string | null | undefined;
  address?: string | null | undefined;
  isOpenMetricsSecretSet?: boolean | null | undefined;
  username?: string | null | undefined;
  isPasswordSet?: boolean | null | undefined;
  collectionProbeId?: { toString: () => string } | string | null | undefined;
  /*
   * The probe as the reader could read it. Judged only when it came back
   * with isGlobalProbe, and the connection with its projectId: a probe the
   * reader may not read says nothing.
   */
  collectionProbe?:
    | {
        isGlobalProbe?: boolean | null | undefined;
        projectId?: { toString: () => string } | string | null | undefined;
        connectionStatus?: string | null | undefined;
      }
    | null
    | undefined;
}

// Why no probe reads this connection now, or null when one will.
export function getXcpNgCollectionStop(
  connection: XcpNgCollectionStopFacts,
  isBillingEnabled: boolean,
): XcpNgCollectionStop | null {
  if (!connection.address) {
    return XcpNgCollectionStop.NoAddress;
  }

  if (connection.connectionType === XcpNgConnectionType.Xapi) {
    if (!connection.username) {
      return XcpNgCollectionStop.NoUserName;
    }

    if (connection.isPasswordSet !== true) {
      return XcpNgCollectionStop.NoPassword;
    }
  } else if (connection.isOpenMetricsSecretSet !== true) {
    return XcpNgCollectionStop.NoSecret;
  }

  if (!connection.collectionProbeId) {
    return XcpNgCollectionStop.NoProbe;
  }

  const probe: XcpNgCollectionStopFacts["collectionProbe"] =
    connection.collectionProbe;

  // The rule the save hooks hold a connection's probe to, which the claim holds too.
  if (
    probe &&
    typeof probe.isGlobalProbe === "boolean" &&
    connection.projectId
  ) {
    const refusal: string | null = XcpNgCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: probe.isGlobalProbe,
        projectId: probe.projectId ? probe.projectId.toString() : null,
      },
      projectId: connection.projectId.toString(),
      isBillingEnabled: isBillingEnabled,
    });

    if (refusal) {
      return XcpNgCollectionStop.ProbeNotAllowed;
    }
  }

  if (probe?.connectionStatus === ProbeConnectionStatus.Disconnected) {
    return XcpNgCollectionStop.ProbeDisconnected;
  }

  return null;
}
