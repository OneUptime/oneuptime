import VMwareCertificateFingerprint from "../VMware/VMwareCertificateFingerprint";
import { StorageArrayProbeCollector } from "../../Types/StorageArray/Collection/StorageArrayProbeCollector";

/*
 * The rules a storage array connection's settings follow (#11004),
 * isomorphic, so the dashboard's form, the server's save hook and the
 * probe agree. They are VMware's agentless collection rules
 * (VMwareCollectionSettings): the same trust model, for the same reason -
 * a read-only account is still a key to a customer's storage.
 */

export const MAX_STORAGE_ARRAY_USERNAME_LENGTH: number = 256;
export const MAX_STORAGE_ARRAY_PASSWORD_LENGTH: number = 256;

// What the rules need to know about a probe.
export interface StorageArrayCollectionProbeFacts {
  isGlobalProbe?: boolean | null | undefined;
  projectId?: string | null | undefined;
}

/*
 * Where a saved password may be sent: the address it was entered for,
 * through the probe it was entered for, to the certificate that was trusted
 * when it was entered. See getPasswordRebindRefusal.
 */
export interface StorageArrayPasswordBinding {
  // "host:port" (StorageArrayConnectionAddress.getEndpointKey), or null.
  endpointKey: string | null;
  probeId: string | null;
  trustedCertificateFingerprint: string | null;
}

export default class StorageArrayConnectionSettings {
  // Why an interval is refused for a platform, or null when it may be used.
  public static getIntervalRefusal(
    value: unknown,
    collector: StorageArrayProbeCollector,
  ): string | null {
    const { minMinutes, maxMinutes } = collector.collectionInterval;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < minMinutes ||
      value > maxMinutes
    ) {
      return `Collect every ${minMinutes} to ${maxMinutes} minutes, in whole minutes.`;
    }
    return null;
  }

  // An interval inside the platform's bounds: its default when out of them.
  public static getSafeInterval(
    value: number | null | undefined,
    collector: StorageArrayProbeCollector,
  ): number {
    if (
      StorageArrayConnectionSettings.getIntervalRefusal(value, collector) ===
      null
    ) {
      return value as number;
    }
    return collector.collectionInterval.defaultMinutes;
  }

  /*
   * Why a probe may not collect a connection of `projectId`, or null when it
   * may. A probe that collects one receives its password, so it has to be a
   * probe the project itself runs. On OneUptime Cloud (billing on) a global
   * probe is shared by every sign-up and never receives one; on a
   * self-hosted instance the global probes are the operator's own.
   */
  public static getProbeRefusal(data: {
    probe: StorageArrayCollectionProbeFacts;
    projectId: string;
    isBillingEnabled: boolean;
  }): string | null {
    const isGlobal: boolean =
      data.probe.isGlobalProbe === true || !data.probe.projectId;

    if (isGlobal) {
      if (data.isBillingEnabled) {
        return "Pick a probe of your own. Shared probes never receive storage passwords - add a probe in the storage network and pick it here.";
      }
      return null;
    }

    if (data.probe.projectId !== data.projectId) {
      return "This probe belongs to another project. Pick one of this project's probes.";
    }

    return null;
  }

  /*
   * Why an update that keeps the saved password must not, or null when it
   * may keep it. The password is write-only, which is only true if editing
   * the connection cannot send it somewhere the editor can read it, so
   * changing the address, the probe or the trusted certificate (to a
   * different one) asks for it again. Going back to "publicly trusted
   * only" is stricter, and keeps it.
   */
  public static getPasswordRebindRefusal(data: {
    saved: StorageArrayPasswordBinding;
    next: StorageArrayPasswordBinding;
  }): string | null {
    if (data.saved.endpointKey !== data.next.endpointKey) {
      return "Enter the password again: a saved password is only sent to the address it was entered for.";
    }

    if ((data.saved.probeId || null) !== (data.next.probeId || null)) {
      return "Enter the password again: a saved password is only sent through the probe it was entered for.";
    }

    const nextFingerprint: string | null =
      VMwareCertificateFingerprint.normalize(
        data.next.trustedCertificateFingerprint,
      );

    if (
      nextFingerprint !== null &&
      !VMwareCertificateFingerprint.areEqual(
        data.saved.trustedCertificateFingerprint,
        nextFingerprint,
      )
    ) {
      return "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.";
    }

    return null;
  }
}
