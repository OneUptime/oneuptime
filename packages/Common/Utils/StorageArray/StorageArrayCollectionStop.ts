import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import StorageArrayConnectionSettings from "./StorageArrayConnectionSettings";

/*
 * WHY NO PROBE READS A STORAGE ARRAY CONNECTION (#11004), FROM THE
 * CONNECTION'S OWN ROW - BY THE RULE THE PROBES' CLAIM HANDS CONNECTIONS
 * OUT BY.
 *
 * The claim (Server/Utils/StorageArray/StorageArrayProbeCollectionStore,
 * getCollectableSql) hands a probe a connection that has the password,
 * address and user name a collection needs and names that probe, which is
 * the project's own - or, on a self-hosted instance, one of the
 * instance's. Any other it sets aside a quarter of an hour at a time, so
 * its nextCollectionAt keeps moving and promises nothing. A probe that is
 * disconnected asks for nothing, whatever the claim would hand it.
 *
 * The project's being served (paid, not blocked) is the claim's rule too,
 * but a page in a project nobody may use is not shown, so it is not here.
 * This is VMware's rule (Utils/VMware/VMwareCollectionStop), for a
 * connection's own columns; its test reads the claim's conditions and
 * fails on one this does not know.
 */

export enum StorageArrayCollectionStop {
  NoPassword = "NoPassword",
  NoAddress = "NoAddress",
  NoUserName = "NoUserName",
  // No probe is named to read it: the claim reads connections by their probe.
  NoProbe = "NoProbe",
  // A shared probe on OneUptime Cloud, or another project's.
  ProbeNotAllowed = "ProbeNotAllowed",
  ProbeDisconnected = "ProbeDisconnected",
}

export interface StorageArrayCollectionStopFacts {
  projectId?: { toString: () => string } | string | null | undefined;
  isPasswordSet?: boolean | null | undefined;
  address?: string | null | undefined;
  username?: string | null | undefined;
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
export function getStorageArrayCollectionStop(
  connection: StorageArrayCollectionStopFacts,
  isBillingEnabled: boolean,
): StorageArrayCollectionStop | null {
  if (connection.isPasswordSet === false) {
    return StorageArrayCollectionStop.NoPassword;
  }

  if (!connection.address) {
    return StorageArrayCollectionStop.NoAddress;
  }

  if (!connection.username) {
    return StorageArrayCollectionStop.NoUserName;
  }

  if (!connection.collectionProbeId) {
    return StorageArrayCollectionStop.NoProbe;
  }

  const probe: StorageArrayCollectionStopFacts["collectionProbe"] =
    connection.collectionProbe;

  // The rule the save hooks hold a connection's probe to, which the claim holds too.
  if (
    probe &&
    typeof probe.isGlobalProbe === "boolean" &&
    connection.projectId
  ) {
    const refusal: string | null =
      StorageArrayConnectionSettings.getProbeRefusal({
        probe: {
          isGlobalProbe: probe.isGlobalProbe,
          projectId: probe.projectId ? probe.projectId.toString() : null,
        },
        projectId: connection.projectId.toString(),
        isBillingEnabled: isBillingEnabled,
      });

    if (refusal) {
      return StorageArrayCollectionStop.ProbeNotAllowed;
    }
  }

  if (probe?.connectionStatus === ProbeConnectionStatus.Disconnected) {
    return StorageArrayCollectionStop.ProbeDisconnected;
  }

  return null;
}
