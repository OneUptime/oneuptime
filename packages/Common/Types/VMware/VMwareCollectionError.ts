/*
 * Why a probe could not collect a vCenter (or a connection test failed), as
 * the probe classifies it. The probe also writes the exact sentence - which
 * host, which user, what the certificate looked like - into
 * collectionError; the code is what the dashboard reads to offer the one
 * next step that fixes it (trust the certificate, fix the password, pick
 * another probe ...).
 *
 * The codes are stored strings: never rename one, only add.
 */
enum VMwareCollectionErrorCode {
  // The address is not one OneUptime can use (not https, has a path ...).
  InvalidAddress = "InvalidAddress",
  /*
   * The address is (or resolves to) loopback, link-local or a cloud metadata
   * endpoint, which no probe ever connects to.
   */
  AddressNotAllowed = "AddressNotAllowed",
  // DNS on the probe has no address for the host name.
  AddressNotFound = "AddressNotFound",
  // Nothing listens on the port: wrong port, or not vCenter's address.
  ConnectionRefused = "ConnectionRefused",
  // No answer: a firewall between the probe and vCenter, or vCenter is down.
  ConnectionTimedOut = "ConnectionTimedOut",
  // Any other network failure (reset, unreachable host or network ...).
  ConnectionFailed = "ConnectionFailed",
  // The TLS handshake itself failed (protocol or cipher mismatch ...).
  TlsFailed = "TlsFailed",
  /*
   * vCenter's certificate is not signed by an authority the probe trusts
   * (vCenter's own VMCA by default), has expired, or names another host - and
   * no certificate was trusted for this vCenter. presentedCertificate says
   * what vCenter showed, so a person can trust exactly that certificate.
   */
  UntrustedCertificate = "UntrustedCertificate",
  /*
   * A certificate was trusted for this vCenter and vCenter now shows a
   * different one: renewed - or someone is in the middle. Nothing is sent
   * until a person trusts the new one.
   */
  CertificateChanged = "CertificateChanged",
  // The address answers HTTPS but is not a vSphere API (no /sdk).
  NotVSphere = "NotVSphere",
  // vCenter refused the user name or password.
  InvalidLogin = "InvalidLogin",
  /*
   * The login worked but the user may not read the inventory: the Read-Only
   * role is missing, or was granted without "Propagate to children".
   */
  NoPermission = "NoPermission",
  // vSphere answered a request with a fault the probe has no advice for.
  ApiError = "ApiError",
  // The collection took longer than its time budget.
  TimedOut = "TimedOut",
  // The collected data is larger than one upload to OneUptime may be.
  PayloadTooLarge = "PayloadTooLarge",
  /*
   * The probe is not allowed to collect this vCenter: it belongs to another
   * project, or it is a shared probe on OneUptime Cloud.
   */
  ProbeNotAllowed = "ProbeNotAllowed",
  /*
   * No probe picked the work up in time: the probe is offline, or runs a
   * OneUptime version older than VMware collection.
   */
  ProbeNotAvailable = "ProbeNotAvailable",
  // Anything else - a bug, with the detail in the message.
  Internal = "Internal",
}

export default VMwareCollectionErrorCode;

export interface VMwareCollectionErrorAdvice {
  // A short title for the problem, e.g. "vCenter refused the login".
  title: string;
  // What to do about it, in a sentence or two.
  nextStep: string;
}

const ADVICE: Record<VMwareCollectionErrorCode, VMwareCollectionErrorAdvice> =
  {
    [VMwareCollectionErrorCode.InvalidAddress]: {
      title: "The vCenter address is not valid",
      nextStep:
        "Enter vCenter's address as you would open it in a browser, such as https://vcsa.example.com - without a path.",
    },
    [VMwareCollectionErrorCode.AddressNotAllowed]: {
      title: "OneUptime does not connect to this address",
      nextStep:
        "Loopback, link-local and cloud metadata addresses are never used. Enter vCenter's own host name or IP address.",
    },
    [VMwareCollectionErrorCode.AddressNotFound]: {
      title: "The probe cannot find this host name",
      nextStep:
        "Check the spelling, or use vCenter's IP address. The name has to resolve in DNS on the probe's network.",
    },
    [VMwareCollectionErrorCode.ConnectionRefused]: {
      title: "Nothing answers on that port",
      nextStep:
        "Check the address and port. vCenter serves its API on HTTPS port 443 unless you changed it.",
    },
    [VMwareCollectionErrorCode.ConnectionTimedOut]: {
      title: "The probe gets no answer from vCenter",
      nextStep:
        "Allow the probe's machine to reach vCenter on TCP 443 through your firewall, or pick a probe in vCenter's network.",
    },
    [VMwareCollectionErrorCode.ConnectionFailed]: {
      title: "The probe could not connect to vCenter",
      nextStep:
        "Check that vCenter is running and that the probe's network can reach it.",
    },
    [VMwareCollectionErrorCode.TlsFailed]: {
      title: "The secure connection to vCenter failed",
      nextStep:
        "vCenter and the probe could not agree on TLS. Check that the address points at vCenter's HTTPS port.",
    },
    [VMwareCollectionErrorCode.UntrustedCertificate]: {
      title: "vCenter's certificate is not trusted",
      nextStep:
        "vCenter uses a certificate from its own authority by default. Check the fingerprint below against vCenter's certificate, then trust it.",
    },
    [VMwareCollectionErrorCode.CertificateChanged]: {
      title: "vCenter's certificate changed",
      nextStep:
        "Nothing is sent to vCenter until you trust the new certificate. If you renewed it, check the new fingerprint and trust it - and enter the password again.",
    },
    [VMwareCollectionErrorCode.NotVSphere]: {
      title: "This address is not a vSphere API",
      nextStep:
        "Enter the address of vCenter Server or a standalone ESXi host - the one the vSphere Client opens.",
    },
    [VMwareCollectionErrorCode.InvalidLogin]: {
      title: "vCenter refused the login",
      nextStep:
        "Check the user name - with its domain, such as oneuptime@vsphere.local - and the password, and that the account is not locked.",
    },
    [VMwareCollectionErrorCode.NoPermission]: {
      title: "The user cannot read vCenter's inventory",
      nextStep:
        "Give the user the Read-Only role on the top-level vCenter object, with Propagate to children ticked.",
    },
    [VMwareCollectionErrorCode.ApiError]: {
      title: "vCenter answered with an error",
      nextStep:
        "The message below is what vCenter said. If it keeps happening, check vCenter's health.",
    },
    [VMwareCollectionErrorCode.TimedOut]: {
      title: "Collecting took too long",
      nextStep:
        "vCenter answered too slowly for this interval. Collect less often, or check vCenter's load.",
    },
    [VMwareCollectionErrorCode.PayloadTooLarge]: {
      title: "This vCenter is too large to collect from a probe",
      nextStep:
        "Its inventory is larger than one probe upload may be. Use the VMware agent for this vCenter.",
    },
    [VMwareCollectionErrorCode.ProbeNotAllowed]: {
      title: "This probe may not collect this vCenter",
      nextStep:
        "Pick a probe of this project's own. Shared OneUptime probes never receive vCenter passwords.",
    },
    [VMwareCollectionErrorCode.ProbeNotAvailable]: {
      title: "The probe did not pick this up",
      nextStep:
        "Check that the probe is connected on the Probes page. A probe older than OneUptime's VMware collection cannot collect vCenters: update it.",
    },
    [VMwareCollectionErrorCode.Internal]: {
      title: "The probe hit an unexpected error",
      nextStep:
        "The message below has the detail. Check the probe's logs, and try again.",
    },
  };

export class VMwareCollectionErrorUtil {
  public static getAll(): Array<VMwareCollectionErrorCode> {
    return Object.values(VMwareCollectionErrorCode);
  }

  public static isValid(value: unknown): value is VMwareCollectionErrorCode {
    return (
      typeof value === "string" &&
      (VMwareCollectionErrorUtil.getAll() as Array<string>).includes(value)
    );
  }

  public static getAdvice(
    code: VMwareCollectionErrorCode,
  ): VMwareCollectionErrorAdvice {
    return ADVICE[code] || ADVICE[VMwareCollectionErrorCode.Internal];
  }

  /*
   * Whether a person can fix the failure by trusting the certificate vCenter
   * presented - the two codes that carry a presentedCertificate.
   */
  public static isCertificateTrustProblem(
    code: VMwareCollectionErrorCode | null | undefined,
  ): boolean {
    return (
      code === VMwareCollectionErrorCode.UntrustedCertificate ||
      code === VMwareCollectionErrorCode.CertificateChanged
    );
  }
}
