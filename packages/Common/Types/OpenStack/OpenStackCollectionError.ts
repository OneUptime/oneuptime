/*
 * Why a probe could not collect a cloud, or a connection test failed, as the probe
 * classifies it. The probe also writes the exact sentence (which host, which
 * credential, what the certificate looked like); the code is what the dashboard
 * reads to offer the one next step that fixes it.
 *
 * The codes are stored strings: never rename one, only add.
 */
enum OpenStackCollectionErrorCode {
  // The auth URL is not one OneUptime can use (not https, has a query ...).
  InvalidAddress = "InvalidAddress",
  /*
   * The address is, or resolves to, loopback, link-local or a cloud metadata
   * endpoint, which no probe ever connects to. This holds for every address the
   * catalog names too, because the catalog is only as trustworthy as the Keystone
   * that wrote it.
   */
  AddressNotAllowed = "AddressNotAllowed",
  // DNS on the probe has no address for the host name.
  AddressNotFound = "AddressNotFound",
  // Nothing listens on the port.
  ConnectionRefused = "ConnectionRefused",
  // No answer: a firewall between the probe and the cloud, or the API is down.
  ConnectionTimedOut = "ConnectionTimedOut",
  // Any other network failure (reset, unreachable host or network ...).
  ConnectionFailed = "ConnectionFailed",
  // The TLS handshake itself failed (protocol or cipher mismatch ...).
  TlsFailed = "TlsFailed",
  /*
   * The certificate is not signed by an authority the probe trusts, has expired,
   * or names another host, and no certificate was trusted for this cloud.
   * presentedCertificate says what the API showed, so a person can trust exactly
   * that certificate.
   */
  UntrustedCertificate = "UntrustedCertificate",
  /*
   * Certificates are trusted for this cloud and an API now shows a different one:
   * renewed, or someone is in the middle. Nothing is sent until a person trusts it.
   */
  CertificateChanged = "CertificateChanged",
  // The catalog names a plain http endpoint, and a token is never sent over one.
  InsecureEndpoint = "InsecureEndpoint",
  // The address answers, but not as Keystone does.
  NotKeystone = "NotKeystone",
  // Keystone refused the application credential or the password.
  InvalidCredential = "InvalidCredential",
  /*
   * The account is fine, but it has no role on the project it asked for, or the
   * project or domain does not exist. An application credential cannot hit this:
   * it is scoped to its own project when it is made.
   */
  WrongProjectScope = "WrongProjectScope",
  // Keystone gave a token with no catalog: an unscoped token, or a project with none.
  NoCatalog = "NoCatalog",
  // A region the cloud is set up with is not in the catalog.
  RegionNotFound = "RegionNotFound",
  /*
   * The login worked, but the credential may not read what monitoring needs. The
   * summary's reads say which, service by service.
   */
  NoPermission = "NoPermission",
  // Keystone answered with a server error, or kept saying it was too busy.
  KeystoneFailing = "KeystoneFailing",
  // A service answered with an error the probe has no advice for.
  ApiError = "ApiError",
  // A service kept answering 429 or a server error, so the probe stopped asking.
  ServiceOverloaded = "ServiceOverloaded",
  // The collection took longer than its time budget.
  TimedOut = "TimedOut",
  // The collected data is larger than one upload to OneUptime may be.
  PayloadTooLarge = "PayloadTooLarge",
  /*
   * The probe may not collect this cloud: it belongs to another project, or it is
   * a shared probe on OneUptime Cloud.
   */
  ProbeNotAllowed = "ProbeNotAllowed",
  /*
   * No probe picked the work up in time: the probe is offline, or runs a OneUptime
   * version older than OpenStack collection.
   */
  ProbeNotAvailable = "ProbeNotAvailable",
  // Anything else: a bug, with the detail in the message.
  Internal = "Internal",
}

export default OpenStackCollectionErrorCode;

export interface OpenStackCollectionErrorAdvice {
  // A short title for the problem, e.g. "Keystone refused the credential".
  title: string;
  // What to do about it, in a sentence or two.
  nextStep: string;
}

const ADVICE: Record<
  OpenStackCollectionErrorCode,
  OpenStackCollectionErrorAdvice
> = {
  [OpenStackCollectionErrorCode.InvalidAddress]: {
    title: "The auth URL is not valid",
    nextStep:
      "Enter Keystone's address over HTTPS, such as https://keystone.example.com:5000/v3.",
  },
  [OpenStackCollectionErrorCode.AddressNotAllowed]: {
    title: "OneUptime does not connect to this address",
    nextStep:
      "Loopback, link-local and cloud metadata addresses are never used, and that includes what the catalog names. Use the address the API answers on in your network.",
  },
  [OpenStackCollectionErrorCode.AddressNotFound]: {
    title: "The probe cannot find this host name",
    nextStep:
      "Check the spelling, or use an IP address. The name has to resolve in DNS on the probe's network.",
  },
  [OpenStackCollectionErrorCode.ConnectionRefused]: {
    title: "Nothing answers on that port",
    nextStep:
      "Check the address and port. Keystone usually serves on 5000, or on 443 behind a path such as /identity.",
  },
  [OpenStackCollectionErrorCode.ConnectionTimedOut]: {
    title: "The probe gets no answer from the cloud",
    nextStep:
      "Allow the probe's machine to reach this API through your firewall, or pick a probe in the cloud's network.",
  },
  [OpenStackCollectionErrorCode.ConnectionFailed]: {
    title: "The probe could not connect to the cloud",
    nextStep:
      "Check that the API is running and that the probe's network can reach it.",
  },
  [OpenStackCollectionErrorCode.TlsFailed]: {
    title: "The secure connection failed",
    nextStep:
      "The API and the probe could not agree on TLS. Check that the address points at an HTTPS port.",
  },
  [OpenStackCollectionErrorCode.UntrustedCertificate]: {
    title: "The API's certificate is not trusted",
    nextStep:
      "A cloud with its own certificate authority needs this. Check the fingerprint below against the API's certificate, then trust it.",
  },
  [OpenStackCollectionErrorCode.CertificateChanged]: {
    title: "The API's certificate changed",
    nextStep:
      "Nothing is sent until you trust the new certificate. If you renewed it, check the new fingerprint and trust it, and enter the credential again.",
  },
  [OpenStackCollectionErrorCode.InsecureEndpoint]: {
    title: "The catalog names a plain HTTP endpoint",
    nextStep:
      "A token is never sent unencrypted. Put the endpoint behind TLS, pick another endpoint interface, or use the OpenStack agent for this cloud.",
  },
  [OpenStackCollectionErrorCode.NotKeystone]: {
    title: "This address is not Keystone",
    nextStep:
      "Enter the Identity endpoint from your clouds.yaml or openrc file: its auth_url.",
  },
  [OpenStackCollectionErrorCode.InvalidCredential]: {
    title: "Keystone refused the credential",
    nextStep:
      "The ID, secret or password is wrong, it has expired or been deleted, or its account lost its role on the project. Make a new one and enter it here.",
  },
  [OpenStackCollectionErrorCode.WrongProjectScope]: {
    title: "The account has no role on that project",
    nextStep:
      "Check the project name and both domains. An application credential avoids this: it is scoped when it is made.",
  },
  [OpenStackCollectionErrorCode.NoCatalog]: {
    title: "Keystone gave this credential no catalog",
    nextStep:
      "The token is not scoped to a project that has endpoints. Scope the credential to a project.",
  },
  [OpenStackCollectionErrorCode.RegionNotFound]: {
    title: "A region is not in the catalog",
    nextStep:
      "Pick from the regions the catalog names. The connection test lists them.",
  },
  [OpenStackCollectionErrorCode.NoPermission]: {
    title: "The credential cannot read what monitoring needs",
    nextStep:
      "The test lists each read it was refused and what goes without it. A credential with admin on its own project, limited by access rules, reads everything.",
  },
  [OpenStackCollectionErrorCode.KeystoneFailing]: {
    title: "Keystone is failing",
    nextStep:
      "Keystone answered with a server error. The probe waits longer between logins until it recovers. Check Keystone's service and the database behind it.",
  },
  [OpenStackCollectionErrorCode.ApiError]: {
    title: "A service answered with an error",
    nextStep:
      "The message below is what it said. If it keeps happening, check that service's health.",
  },
  [OpenStackCollectionErrorCode.ServiceOverloaded]: {
    title: "A service is too busy to answer",
    nextStep:
      "It kept answering 429 or a server error, so the probe waits longer between collections until it recovers. Collect less often, or check its load.",
  },
  [OpenStackCollectionErrorCode.TimedOut]: {
    title: "Collecting took too long",
    nextStep:
      "The cloud answered too slowly for this interval. Collect less often, or check its load.",
  },
  [OpenStackCollectionErrorCode.PayloadTooLarge]: {
    title: "This cloud is too large to collect from a probe",
    nextStep:
      "Its inventory is larger than one probe upload may be. Use the OpenStack agent for this cloud.",
  },
  [OpenStackCollectionErrorCode.ProbeNotAllowed]: {
    title: "This probe may not collect this cloud",
    nextStep:
      "Pick a probe of this project's own. Shared OneUptime probes never receive OpenStack credentials.",
  },
  [OpenStackCollectionErrorCode.ProbeNotAvailable]: {
    title: "The probe did not pick this up",
    nextStep:
      "Check that the probe is connected on the Probes page. A probe older than OneUptime's OpenStack collection cannot collect clouds: update it.",
  },
  [OpenStackCollectionErrorCode.Internal]: {
    title: "The probe hit an unexpected error",
    nextStep:
      "The message below has the detail. Check the probe's logs, and try again.",
  },
};

export class OpenStackCollectionErrorUtil {
  public static getAll(): Array<OpenStackCollectionErrorCode> {
    return Object.values(OpenStackCollectionErrorCode);
  }

  public static isValid(value: unknown): value is OpenStackCollectionErrorCode {
    return (
      typeof value === "string" &&
      (OpenStackCollectionErrorUtil.getAll() as Array<string>).includes(value)
    );
  }

  public static getAdvice(
    code: OpenStackCollectionErrorCode,
  ): OpenStackCollectionErrorAdvice {
    return ADVICE[code] || ADVICE[OpenStackCollectionErrorCode.Internal];
  }

  /*
   * Whether a person can fix the failure by trusting the certificate the API
   * presented: the two codes that carry a presentedCertificate.
   */
  public static isCertificateTrustProblem(
    code: OpenStackCollectionErrorCode | null | undefined,
  ): boolean {
    return (
      code === OpenStackCollectionErrorCode.UntrustedCertificate ||
      code === OpenStackCollectionErrorCode.CertificateChanged
    );
  }
}
