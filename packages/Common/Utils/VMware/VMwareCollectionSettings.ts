import VMwareCertificateFingerprint from "./VMwareCertificateFingerprint";

/*
 * The rules a probe-collected vCenter's settings are held to, in one pure
 * place so the server's save hook, the probe-ingest routes and the
 * dashboard's form all apply the same ones.
 */

/*
 * How often a probe collects a vCenter. Two minutes is the VMware agent's own
 * default (VCENTER_COLLECTION_INTERVAL), so the alert templates and charts
 * see the same density of data whichever way a vCenter is collected; large
 * vCenters can be collected less often to go easier on vCenter.
 */
export const DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES: number = 2;
export const MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES: number = 1;
export const MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES: number = 60;

// The longest user name and password a vCenter connection takes.
export const MAX_VMWARE_USERNAME_LENGTH: number = 256;
export const MAX_VMWARE_PASSWORD_LENGTH: number = 256;

// What the rules need to know about a probe.
export interface VMwareCollectionProbeFacts {
  isGlobalProbe?: boolean | null | undefined;
  projectId?: string | null | undefined;
}

/*
 * Where a saved password may be sent: the vCenter address it was entered
 * for, through the probe it was entered for, to the certificate that was
 * trusted when it was entered. See getPasswordRebindRefusal.
 */
export interface VMwarePasswordBinding {
  // "host:port" (VMwareVCenterAddress.getEndpointKey), or null.
  endpointKey: string | null;
  probeId: string | null;
  trustedCertificateFingerprint: string | null;
}

export default class VMwareCollectionSettings {
  /*
   * Why an interval is refused, or null when it is a whole number of minutes
   * inside the bounds.
   */
  public static getIntervalRefusal(value: unknown): string | null {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES ||
      value > MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES
    ) {
      return `Collect every ${MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES} to ${MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES} minutes, in whole minutes.`;
    }

    return null;
  }

  /*
   * Why a probe may not collect a vCenter of `projectId`, or null when it may.
   *
   * A probe that collects a vCenter receives its password, so it has to be a
   * probe the project itself runs. A global probe is shared: on OneUptime
   * Cloud (billing on) every sign-up's monitors run on it, and it must never
   * hold one customer's vCenter password - nor be pointed into the network it
   * runs in. On a self-hosted instance the global probes are the instance's
   * own, run by the same people as everything else, which is exactly the
   * "no extra machine" case; there they may.
   */
  public static getProbeRefusal(data: {
    probe: VMwareCollectionProbeFacts;
    projectId: string;
    isBillingEnabled: boolean;
  }): string | null {
    const isGlobal: boolean =
      data.probe.isGlobalProbe === true || !data.probe.projectId;

    if (isGlobal) {
      if (data.isBillingEnabled) {
        return "Pick a probe of your own. Shared probes never receive vCenter passwords - add a probe in vCenter's network and pick it here.";
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
   * may keep it.
   *
   * The password is write-only: nobody can read it back, including the
   * people who may edit the vCenter. That is only true if editing cannot send
   * it somewhere they can read it. So a saved password is bound to where it
   * was entered for, and changing any of these asks for it again:
   *
   *   - the address (host and port): otherwise pointing the vCenter at a
   *     server of one's own would deliver the password there;
   *   - the probe: otherwise a probe of one's own would be handed it;
   *   - the trusted certificate, to a different one: otherwise trusting a
   *     certificate of one's own would let a machine in the middle read it.
   *
   * Going from a trusted certificate back to "publicly trusted only" is
   * stricter, so it keeps the password.
   */
  public static getPasswordRebindRefusal(data: {
    saved: VMwarePasswordBinding;
    next: VMwarePasswordBinding;
  }): string | null {
    if (data.saved.endpointKey !== data.next.endpointKey) {
      return "Enter the password again: a saved password is only sent to the vCenter address it was entered for.";
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
