import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import OpenStackCollectionSettings from "./OpenStackCollectionSettings";

/*
 * WHY NO PROBE COLLECTS A PROBE-COLLECTED OPENSTACK CLOUD, FROM THE CLOUD'S
 * OWN ROW - BY THE RULE THE PROBES' CLAIM HANDS CLOUDS OUT BY.
 *
 * The claim (Server/Utils/OpenStack/OpenStackProbeCollectionStore,
 * claimDueClouds and getCollectableSql) hands a probe a cloud that is
 * collected by a probe, not archived, has a credential and Keystone's
 * address, and names that probe, which is the project's own - or, on a
 * self-hosted instance, one of the instance's. Any other cloud it sets
 * aside a quarter of an hour at a time, so its nextCollectionAt keeps
 * moving and is never overdue: the card read its last status ("Collecting")
 * for good (OneUptime issue #8042). A probe that is disconnected asks for
 * nothing, whatever the claim would hand it.
 *
 * The project's being served (paid, not blocked) is the claim's rule too,
 * but a page in a project nobody may use is not shown, so it is not here.
 *
 * Keep this in step with the claim: OpenStackCollectionStop's test reads the
 * claim's conditions and fails on one this does not know.
 */

export enum OpenStackCollectionStop {
  // An archived cloud is not collected by a probe until it is unarchived.
  Archived = "Archived",
  NoCredential = "NoCredential",
  NoAddress = "NoAddress",
  // No probe is named to collect it: the claim reads clouds by their probe.
  NoProbe = "NoProbe",
  // A shared probe on OneUptime Cloud, or another project's.
  ProbeNotAllowed = "ProbeNotAllowed",
  ProbeDisconnected = "ProbeDisconnected",
}

export interface OpenStackCollectionStopFacts {
  projectId?: { toString: () => string } | string | null | undefined;
  isArchived?: boolean | null | undefined;
  isCredentialSet?: boolean | null | undefined;
  authUrl?: string | null | undefined;
  collectionProbeId?: { toString: () => string } | string | null | undefined;
  /*
   * The probe as the reader could read it. Judged only when it came back
   * with isGlobalProbe, and the cloud with its projectId: a probe the reader
   * may not read says nothing.
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

// Why no probe collects this probe-collected cloud now, or null when one will.
export function getOpenStackCollectionStop(
  cloud: OpenStackCollectionStopFacts,
  isBillingEnabled: boolean,
): OpenStackCollectionStop | null {
  if (cloud.isArchived === true) {
    return OpenStackCollectionStop.Archived;
  }

  if (cloud.isCredentialSet === false) {
    return OpenStackCollectionStop.NoCredential;
  }

  if (!cloud.authUrl) {
    return OpenStackCollectionStop.NoAddress;
  }

  if (!cloud.collectionProbeId) {
    return OpenStackCollectionStop.NoProbe;
  }

  const probe: OpenStackCollectionStopFacts["collectionProbe"] =
    cloud.collectionProbe;

  // The rule the save hooks hold a cloud's probe to, which the claim holds too.
  if (probe && typeof probe.isGlobalProbe === "boolean" && cloud.projectId) {
    const refusal: string | null = OpenStackCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: probe.isGlobalProbe,
        projectId: probe.projectId ? probe.projectId.toString() : null,
      },
      projectId: cloud.projectId.toString(),
      isBillingEnabled: isBillingEnabled,
    });

    if (refusal) {
      return OpenStackCollectionStop.ProbeNotAllowed;
    }
  }

  if (probe?.connectionStatus === ProbeConnectionStatus.Disconnected) {
    return OpenStackCollectionStop.ProbeDisconnected;
  }

  return null;
}
