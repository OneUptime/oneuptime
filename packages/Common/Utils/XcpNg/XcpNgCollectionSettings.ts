import VMwareCertificateFingerprint from "../VMware/VMwareCertificateFingerprint";

/*
 * The rules an XCP-ng connection's settings are held to, in one pure place
 * so the server's save hook, the probe-ingest routes and the dashboard's
 * form all apply the same ones. They are a vCenter's
 * (VMwareCollectionSettings), rule for rule, in the words of what is being
 * connected.
 */

/*
 * How often a probe reads a connection. Xen Orchestra reads the hosts' RRDs
 * at 60-second resolution, and XAPI keeps them at a minute for two hours:
 * every minute is the XCP-ng Agent's own scrape interval, so the alert
 * templates and charts see the same density of data whichever way a pool
 * is read.
 */
export const DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES: number = 1;
export const MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES: number = 1;
export const MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES: number = 60;

// The longest secrets and account names a connection takes.
export const MAX_XCP_NG_SECRET_LENGTH: number = 1024;
export const MAX_XCP_NG_USERNAME_LENGTH: number = 256;
export const MAX_XCP_NG_PASSWORD_LENGTH: number = 256;

/*
 * How long before an API token expires its connection's owners are warned
 * (#10996): two weeks, time to make a new one.
 */
export const XCP_NG_API_TOKEN_WARNING_DAYS: number = 14;

// What the rules need to know about a probe.
export interface XcpNgCollectionProbeFacts {
  isGlobalProbe?: boolean | null | undefined;
  projectId?: string | null | undefined;
}

/*
 * Where a saved secret may be sent: the address it was entered for, through
 * the probe it was entered for, to the certificate that was trusted when it
 * was entered. See getSecretRebindRefusal.
 */
export interface XcpNgSecretBinding {
  // "host:port" (XcpNgConnectionAddress.getEndpointKey), or null.
  endpointKey: string | null;
  probeId: string | null;
  trustedCertificateFingerprint: string | null;
}

export default class XcpNgCollectionSettings {
  /*
   * Why an interval is refused, or null when it is a whole number of minutes
   * inside the bounds.
   */
  public static getIntervalRefusal(value: unknown): string | null {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES ||
      value > MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES
    ) {
      return `Collect every ${MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES} to ${MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES} minutes, in whole minutes.`;
    }

    return null;
  }

  /*
   * Why a probe may not read a connection of `projectId`, or null when it
   * may - the rule a vCenter's probe is held to.
   *
   * A probe that reads a connection receives its secrets - for XAPI, often
   * the pool's root password - so it has to be a probe the project itself
   * runs. A global probe is shared: on OneUptime Cloud (billing on) every
   * sign-up's monitors run on it, and it must never hold one customer's
   * secrets, nor be pointed into the network it runs in. On a self-hosted
   * instance the global probes are the instance's own, run by the same
   * people as everything else; there they may.
   */
  public static getProbeRefusal(data: {
    probe: XcpNgCollectionProbeFacts;
    projectId: string;
    isBillingEnabled: boolean;
  }): string | null {
    const isGlobal: boolean =
      data.probe.isGlobalProbe === true || !data.probe.projectId;

    if (isGlobal) {
      if (data.isBillingEnabled) {
        return "Pick a probe of your own. Shared probes never receive XCP-ng secrets - add a probe in the network of your Xen Orchestra or pool and pick it here.";
      }

      return null;
    }

    if (data.probe.projectId !== data.projectId) {
      return "This probe belongs to another project. Pick one of this project's probes.";
    }

    return null;
  }

  /*
   * Why an update that keeps the saved secrets must not, or null when it may
   * keep them - the rule a vCenter's password is held to.
   *
   * The secrets are write-only: nobody can read them back, including the
   * people who may edit the connection. That is only true if editing cannot
   * send them somewhere they can read them. So a saved secret is bound to
   * where it was entered for, and changing any of these asks for it again:
   *
   *   - the address (host and port): otherwise pointing the connection at a
   *     server of one's own would deliver the secret there;
   *   - the probe: otherwise a probe of one's own would be handed it;
   *   - the trusted certificate, to a different one: otherwise trusting a
   *     certificate of one's own would let a machine in the middle read it.
   *
   * Going from a trusted certificate back to "publicly trusted only" is
   * stricter, so it keeps them.
   */
  public static getSecretRebindRefusal(data: {
    saved: XcpNgSecretBinding;
    next: XcpNgSecretBinding;
    // What is asked for again: "the secret", "the password".
    secretName: string;
  }): string | null {
    if (data.saved.endpointKey !== data.next.endpointKey) {
      return `Enter ${data.secretName} again: a saved secret is only sent to the address it was entered for.`;
    }

    if ((data.saved.probeId || null) !== (data.next.probeId || null)) {
      return `Enter ${data.secretName} again: a saved secret is only sent through the probe it was entered for.`;
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
      return `Enter ${data.secretName} again: a saved secret is only sent to the certificate that was trusted when it was entered.`;
    }

    return null;
  }

  /*
   * Whether two bindings send a saved secret to the same place. A binding
   * that moves forgets a saved API token that was not entered again.
   */
  public static isSameBinding(
    first: XcpNgSecretBinding,
    second: XcpNgSecretBinding,
  ): boolean {
    return (
      first.endpointKey === second.endpointKey &&
      (first.probeId || null) === (second.probeId || null) &&
      (VMwareCertificateFingerprint.normalize(
        first.trustedCertificateFingerprint,
      ) || null) ===
        (VMwareCertificateFingerprint.normalize(
          second.trustedCertificateFingerprint,
        ) || null)
    );
  }

  /*
   * Whether an API token that expires at `expiresAt` is to be warned about
   * now: within XCP_NG_API_TOKEN_WARNING_DAYS of it, and not yet expired.
   */
  public static isApiTokenExpiringSoon(data: {
    expiresAt: Date | string | null | undefined;
    now: Date;
  }): boolean {
    const expiresAt: number = XcpNgCollectionSettings.toTime(data.expiresAt);

    if (!Number.isFinite(expiresAt)) {
      return false;
    }

    const now: number = data.now.getTime();
    const window: number = XCP_NG_API_TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000;

    return expiresAt > now && expiresAt - now <= window;
  }

  public static isApiTokenExpired(data: {
    expiresAt: Date | string | null | undefined;
    now: Date;
  }): boolean {
    const expiresAt: number = XcpNgCollectionSettings.toTime(data.expiresAt);

    return Number.isFinite(expiresAt) && expiresAt <= data.now.getTime();
  }

  private static toTime(value: Date | string | null | undefined): number {
    if (!value) {
      return Number.NaN;
    }

    const time: number =
      value instanceof Date ? value.getTime() : new Date(value).getTime();

    return Number.isNaN(time) ? Number.NaN : time;
  }
}
