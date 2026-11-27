/*
 * Why a probe could not read an XCP-ng connection (or a connection test
 * failed), as the probe classifies it. The probe also writes the exact
 * sentence - which address, which account, what the certificate looked
 * like - into collectionError; the code is what the dashboard reads to offer
 * the one next step that fixes it (trust the certificate, fix the secret,
 * load the plugin, make a new token ...).
 *
 * The network and certificate codes are a vCenter's
 * (VMwareCollectionErrorCode), word for word where they mean the same; the
 * rest are Xen Orchestra's and XAPI's own.
 *
 * The codes are stored strings: never rename one, only add.
 */
enum XcpNgCollectionErrorCode {
  // The address is not one OneUptime can use (not https, has a path ...).
  InvalidAddress = "InvalidAddress",
  /*
   * The address is (or resolves to) loopback, link-local or a cloud
   * metadata endpoint, which no probe ever connects to.
   */
  AddressNotAllowed = "AddressNotAllowed",
  // DNS on the probe has no address for the host name.
  AddressNotFound = "AddressNotFound",
  // Nothing listens on the port: wrong port, or not the right address.
  ConnectionRefused = "ConnectionRefused",
  // No answer: a firewall between the probe and the address, or it is down.
  ConnectionTimedOut = "ConnectionTimedOut",
  // Any other network failure (reset, unreachable host or network ...).
  ConnectionFailed = "ConnectionFailed",
  // The TLS handshake itself failed (protocol or cipher mismatch ...).
  TlsFailed = "TlsFailed",
  /*
   * The certificate is not signed by an authority the probe trusts (Xen
   * Orchestra's and XCP-ng's own self-signed ones, by default), has
   * expired, or names another host - and no certificate was trusted for
   * this connection. presentedCertificate says what was shown, so a person
   * can trust exactly that certificate.
   */
  UntrustedCertificate = "UntrustedCertificate",
  /*
   * A certificate was trusted for this connection and the address now shows
   * a different one: renewed - or someone is in the middle. Nothing is sent
   * until a person trusts the new one.
   */
  CertificateChanged = "CertificateChanged",

  // --- Xen Orchestra (#10996) ---------------------------------------------

  // The address answers HTTPS but is not Xen Orchestra (no /openmetrics).
  NotXenOrchestra = "NotXenOrchestra",
  /*
   * Xen Orchestra answers, but its OpenMetrics plugin does not: the plugin
   * is not loaded (Settings -> Plugins -> openmetrics).
   */
  PluginNotLoaded = "PluginNotLoaded",
  /*
   * Xen Orchestra has no OpenMetrics plugin to load: it is older than 6.0,
   * or a Xen Orchestra Appliance without the Premium licence. Told apart
   * from PluginNotLoaded only with an API token that may read plugins.
   */
  PluginUnavailable = "PluginUnavailable",
  // The plugin refused the secret.
  WrongSecret = "WrongSecret",
  /*
   * Xen Orchestra refused the API token: it is wrong, or it expired (Xen
   * Orchestra forgets an expired token, so the two read the same).
   */
  TokenRejected = "TokenRejected",
  /*
   * The token's expiry, as the probe last read it, has passed, and Xen
   * Orchestra refuses it.
   */
  TokenExpired = "TokenExpired",
  /*
   * The token's user is a Xen Orchestra administrator, or holds a privilege
   * beyond reading: OneUptime holds only read-only tokens.
   */
  TokenNotReadOnly = "TokenNotReadOnly",
  // The token reads, but not alarms, messages or backup logs.
  TokenCannotReadAlarms = "TokenCannotReadAlarms",
  // Xen Orchestra (or XAPI) reports no pool at all.
  NoPools = "NoPools",

  // --- XAPI (#10999) ------------------------------------------------------

  // The address answers HTTPS but is not an XCP-ng host's XAPI.
  NotXapi = "NotXapi",
  // XAPI refused the user name or password.
  InvalidLogin = "InvalidLogin",
  /*
   * The host is a pool member, not its master, and the master it names is
   * not one this connection may follow to (unknown, or its certificate is
   * not one the pool vouched for).
   */
  NotPoolMaster = "NotPoolMaster",
  // The login worked but the account may not read the pool.
  NoPermission = "NoPermission",

  // --- Common ------------------------------------------------------------

  // The API answered a request with an error the probe has no advice for.
  ApiError = "ApiError",
  // The collection took longer than its time budget.
  TimedOut = "TimedOut",
  // The collected data is larger than one upload to OneUptime may be.
  PayloadTooLarge = "PayloadTooLarge",
  /*
   * The probe may not read this connection: it belongs to another project,
   * or it is a shared probe on OneUptime Cloud.
   */
  ProbeNotAllowed = "ProbeNotAllowed",
  /*
   * No probe picked the work up in time: the probe is offline, or runs a
   * OneUptime version older than XCP-ng collection.
   */
  ProbeNotAvailable = "ProbeNotAvailable",
  // Anything else - a bug, with the detail in the message.
  Internal = "Internal",
}

export default XcpNgCollectionErrorCode;

export interface XcpNgCollectionErrorAdvice {
  // A short title for the problem, e.g. "Xen Orchestra refused the secret".
  title: string;
  // What to do about it, in a sentence or two.
  nextStep: string;
}

const ADVICE: Record<XcpNgCollectionErrorCode, XcpNgCollectionErrorAdvice> = {
  [XcpNgCollectionErrorCode.InvalidAddress]: {
    title: "The address is not valid",
    nextStep:
      "Enter the address as you would open it in a browser, such as https://xo.example.com - without a path.",
  },
  [XcpNgCollectionErrorCode.AddressNotAllowed]: {
    title: "OneUptime does not connect to this address",
    nextStep:
      "Loopback, link-local and cloud metadata addresses are never used. Enter the host name or IP address it answers on in your network.",
  },
  [XcpNgCollectionErrorCode.AddressNotFound]: {
    title: "The probe cannot find this host name",
    nextStep:
      "Check the spelling, or use the IP address. The name has to resolve in DNS on the probe's network.",
  },
  [XcpNgCollectionErrorCode.ConnectionRefused]: {
    title: "Nothing answers on that port",
    nextStep:
      "Check the address and port. Xen Orchestra and XAPI serve HTTPS on port 443 unless you changed it.",
  },
  [XcpNgCollectionErrorCode.ConnectionTimedOut]: {
    title: "The probe gets no answer",
    nextStep:
      "Allow the probe's machine to reach the address on its HTTPS port through your firewall, or pick a probe in the same network.",
  },
  [XcpNgCollectionErrorCode.ConnectionFailed]: {
    title: "The probe could not connect",
    nextStep:
      "Check that the address is up and that the probe's network can reach it.",
  },
  [XcpNgCollectionErrorCode.TlsFailed]: {
    title: "The secure connection failed",
    nextStep:
      "The probe and the address could not agree on TLS. Check that the address points at an HTTPS port.",
  },
  [XcpNgCollectionErrorCode.UntrustedCertificate]: {
    title: "The certificate is not trusted",
    nextStep:
      "Xen Orchestra and XCP-ng sign their own certificates by default. Check the fingerprint below against the certificate, then trust it.",
  },
  [XcpNgCollectionErrorCode.CertificateChanged]: {
    title: "The certificate changed",
    nextStep:
      "Nothing is sent until you trust the new certificate. If you renewed it, check the new fingerprint and trust it - and enter the secrets again.",
  },
  [XcpNgCollectionErrorCode.NotXenOrchestra]: {
    title: "This address is not Xen Orchestra",
    nextStep:
      "Enter the address you open Xen Orchestra at, such as https://xo.example.com.",
  },
  [XcpNgCollectionErrorCode.PluginNotLoaded]: {
    title: "The OpenMetrics plugin does not answer",
    nextStep:
      "In Xen Orchestra, open Settings, then Plugins, and load openmetrics. On the Xen Orchestra Appliance it needs a Premium licence; without one, connect each pool with XAPI instead.",
  },
  [XcpNgCollectionErrorCode.PluginUnavailable]: {
    title: "This Xen Orchestra has no OpenMetrics plugin",
    nextStep:
      "It needs Xen Orchestra 6.9 or later, and on the Xen Orchestra Appliance a Premium licence. Without one, connect each pool with XAPI instead.",
  },
  [XcpNgCollectionErrorCode.WrongSecret]: {
    title: "Xen Orchestra refused the secret",
    nextStep:
      "Copy the secret again from Settings, then Plugins, then openmetrics in Xen Orchestra, and save it here.",
  },
  [XcpNgCollectionErrorCode.TokenRejected]: {
    title: "Xen Orchestra refused the API token",
    nextStep:
      "The token is wrong or has expired. Create a new one for the read-only user and save it here.",
  },
  [XcpNgCollectionErrorCode.TokenExpired]: {
    title: "The API token expired",
    nextStep:
      "Create a new token for the read-only user in Xen Orchestra and save it here. Metrics keep coming; alarms and backups need the token.",
  },
  [XcpNgCollectionErrorCode.TokenNotReadOnly]: {
    title: "The API token can change Xen Orchestra",
    nextStep:
      "OneUptime holds only read-only tokens. Create one for a user holding a copy of the built-in Read only role, and no other role.",
  },
  [XcpNgCollectionErrorCode.TokenCannotReadAlarms]: {
    title: "The API token cannot read alarms, messages or backups",
    nextStep:
      "Give the token's user a copy of Xen Orchestra's built-in Read only role, which reads alarms, messages and backup logs.",
  },
  [XcpNgCollectionErrorCode.NoPools]: {
    title: "No pool is connected",
    nextStep:
      "Xen Orchestra reports no connected pool. Add or reconnect your pools in Xen Orchestra, then test again.",
  },
  [XcpNgCollectionErrorCode.NotXapi]: {
    title: "This address is not an XCP-ng host",
    nextStep:
      "Enter the address of the pool master: the host XAPI answers on, such as https://10.0.0.10.",
  },
  [XcpNgCollectionErrorCode.InvalidLogin]: {
    title: "XAPI refused the login",
    nextStep:
      "Check the user name and password. An Active Directory user is written with its domain, such as EXAMPLE\\oneuptime.",
  },
  [XcpNgCollectionErrorCode.NotPoolMaster]: {
    title: "This host is not the pool master",
    nextStep:
      "Enter the address of the pool master, named below, and test again.",
  },
  [XcpNgCollectionErrorCode.NoPermission]: {
    title: "The account cannot read the pool",
    nextStep:
      "Give the Active Directory user the read-only role on the pool, or use an account that has it.",
  },
  [XcpNgCollectionErrorCode.ApiError]: {
    title: "The API answered with an error",
    nextStep:
      "The message below is what it said. If it keeps happening, check the health of Xen Orchestra or the pool master.",
  },
  [XcpNgCollectionErrorCode.TimedOut]: {
    title: "Reading took too long",
    nextStep:
      "The answer came too slowly for this interval. Collect less often, or check the load on Xen Orchestra or the pool.",
  },
  [XcpNgCollectionErrorCode.PayloadTooLarge]: {
    title: "This connection is too large to read from a probe",
    nextStep:
      "Its metrics are larger than one probe upload may be. Use the XCP-ng Agent for it.",
  },
  [XcpNgCollectionErrorCode.ProbeNotAllowed]: {
    title: "This probe may not read this connection",
    nextStep:
      "Pick a probe of this project's own. Shared OneUptime probes never receive secrets.",
  },
  [XcpNgCollectionErrorCode.ProbeNotAvailable]: {
    title: "The probe did not pick this up",
    nextStep:
      "Check that the probe is connected on the Probes page. A probe older than OneUptime's XCP-ng collection cannot read pools: update it.",
  },
  [XcpNgCollectionErrorCode.Internal]: {
    title: "The probe hit an unexpected error",
    nextStep:
      "The message below has the detail. Check the probe's logs, and try again.",
  },
};

export class XcpNgCollectionErrorUtil {
  public static getAll(): Array<XcpNgCollectionErrorCode> {
    return Object.values(XcpNgCollectionErrorCode);
  }

  public static isValid(value: unknown): value is XcpNgCollectionErrorCode {
    return (
      typeof value === "string" &&
      (XcpNgCollectionErrorUtil.getAll() as Array<string>).includes(value)
    );
  }

  public static getAdvice(
    code: XcpNgCollectionErrorCode,
  ): XcpNgCollectionErrorAdvice {
    return ADVICE[code] || ADVICE[XcpNgCollectionErrorCode.Internal];
  }

  /*
   * Whether a person can fix the failure by trusting the certificate the
   * address presented - the two codes that carry a presentedCertificate.
   */
  public static isCertificateTrustProblem(
    code: XcpNgCollectionErrorCode | null | undefined,
  ): boolean {
    return (
      code === XcpNgCollectionErrorCode.UntrustedCertificate ||
      code === XcpNgCollectionErrorCode.CertificateChanged
    );
  }

  /*
   * Failures of the API token alone. Metrics come through the plugin's
   * secret, so a collection that reads them is still a success with one of
   * these as a warning; a test says them as its result.
   */
  public static isApiTokenProblem(
    code: XcpNgCollectionErrorCode | null | undefined,
  ): boolean {
    return (
      code === XcpNgCollectionErrorCode.TokenRejected ||
      code === XcpNgCollectionErrorCode.TokenExpired ||
      code === XcpNgCollectionErrorCode.TokenNotReadOnly ||
      code === XcpNgCollectionErrorCode.TokenCannotReadAlarms
    );
  }
}
