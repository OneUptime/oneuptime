import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import VMwareCollectionSettings from "./VMwareCollectionSettings";

/*
 * WHY NO PROBE COLLECTS A PROBE-COLLECTED VCENTER, FROM THE VCENTER'S OWN
 * ROW - BY THE RULE THE PROBES' CLAIM HANDS VCENTERS OUT BY.
 *
 * The claim (Server/Utils/VMware/VMwareProbeCollectionStore,
 * claimDueVCenters and getCollectableSql) hands a probe a vCenter that is
 * collected by a probe and has the password, address and user name a
 * collection needs, and names that probe, which is the project's own - or,
 * on a self-hosted instance, one of the instance's. Any other vCenter it
 * sets aside a quarter of an hour at a time, so its nextCollectionAt keeps
 * moving: the card read its last status ("Collecting") for good (OneUptime
 * issue #8042). A probe that is disconnected asks for nothing, whatever the
 * claim would hand it. An archived vCenter is still collected.
 *
 * The project's being served (paid, not blocked) is the claim's rule too,
 * but a page in a project nobody may use is not shown, so it is not here.
 *
 * Keep this in step with the claim: VMwareCollectionStop's test reads the
 * claim's conditions and fails on one this does not know.
 */

export enum VMwareCollectionStop {
  NoPassword = "NoPassword",
  NoAddress = "NoAddress",
  NoUserName = "NoUserName",
  // No probe is named to collect it: the claim reads vCenters by their probe.
  NoProbe = "NoProbe",
  // A shared probe on OneUptime Cloud, or another project's.
  ProbeNotAllowed = "ProbeNotAllowed",
  ProbeDisconnected = "ProbeDisconnected",
}

export interface VMwareCollectionStopFacts {
  projectId?: { toString: () => string } | string | null | undefined;
  isVCenterPasswordSet?: boolean | null | undefined;
  vcenterUrl?: string | null | undefined;
  vcenterUsername?: string | null | undefined;
  collectionProbeId?: { toString: () => string } | string | null | undefined;
  /*
   * The probe as the reader could read it. Judged only when it came back
   * with isGlobalProbe, and the vCenter with its projectId: a probe the
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

// Why no probe collects this probe-collected vCenter now, or null when one will.
export function getVMwareCollectionStop(
  vcenter: VMwareCollectionStopFacts,
  isBillingEnabled: boolean,
): VMwareCollectionStop | null {
  if (vcenter.isVCenterPasswordSet === false) {
    return VMwareCollectionStop.NoPassword;
  }

  if (!vcenter.vcenterUrl) {
    return VMwareCollectionStop.NoAddress;
  }

  if (!vcenter.vcenterUsername) {
    return VMwareCollectionStop.NoUserName;
  }

  if (!vcenter.collectionProbeId) {
    return VMwareCollectionStop.NoProbe;
  }

  const probe: VMwareCollectionStopFacts["collectionProbe"] =
    vcenter.collectionProbe;

  // The rule the save hooks hold a vCenter's probe to, which the claim holds too.
  if (probe && typeof probe.isGlobalProbe === "boolean" && vcenter.projectId) {
    const refusal: string | null = VMwareCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe: probe.isGlobalProbe,
        projectId: probe.projectId ? probe.projectId.toString() : null,
      },
      projectId: vcenter.projectId.toString(),
      isBillingEnabled: isBillingEnabled,
    });

    if (refusal) {
      return VMwareCollectionStop.ProbeNotAllowed;
    }
  }

  if (probe?.connectionStatus === ProbeConnectionStatus.Disconnected) {
    return VMwareCollectionStop.ProbeDisconnected;
  }

  return null;
}
