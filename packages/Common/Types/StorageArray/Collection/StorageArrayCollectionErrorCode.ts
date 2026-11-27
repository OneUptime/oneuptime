/*
 * Why a probe could not collect a storage array connection (a Unisphere for
 * PowerMax), or why its connection test failed, as the probe classifies it.
 * The probe also writes the exact sentence - which host, which user, what
 * the certificate looked like - into the error message; the code is what
 * the dashboard reads to offer the one next step that fixes it (trust the
 * certificate, fix the password, give the account its role, pick another
 * probe ...).
 *
 * The codes are stored strings: never rename one, only add.
 */
enum StorageArrayCollectionErrorCode {
  // The address is not one OneUptime can use (not https, has a path ...).
  InvalidAddress = "InvalidAddress",
  /*
   * The address is (or resolves to) loopback, link-local or a cloud metadata
   * endpoint, which no probe ever connects to.
   */
  AddressNotAllowed = "AddressNotAllowed",
  // DNS on the probe has no address for the host name.
  AddressNotFound = "AddressNotFound",
  // Nothing listens on the port: wrong port, or the server is down.
  ConnectionRefused = "ConnectionRefused",
  // No answer: a firewall between the probe and the server, or it is down.
  ConnectionTimedOut = "ConnectionTimedOut",
  // Any other network failure (reset, unreachable host or network ...).
  ConnectionFailed = "ConnectionFailed",
  // The TLS handshake itself failed (protocol or cipher mismatch ...).
  TlsFailed = "TlsFailed",
  /*
   * The server's certificate is not signed by an authority the probe
   * trusts (Unisphere's own self-signed one, by default), has expired, or
   * names another host - and no certificate was trusted for it yet. The
   * report's presented certificate says what it showed.
   */
  UntrustedCertificate = "UntrustedCertificate",
  /*
   * A certificate was trusted and the server now shows a different one:
   * renewed - or someone is in the middle. Nothing is sent until a person
   * trusts the new one.
   */
  CertificateChanged = "CertificateChanged",
  // The address answers HTTPS but is not the management server's REST API.
  NotManagementServer = "NotManagementServer",
  // The management server is older than OneUptime reads (Unisphere < 10.1).
  UnsupportedVersion = "UnsupportedVersion",
  // The server refused the user name or password.
  InvalidLogin = "InvalidLogin",
  /*
   * The login worked but the account may not read the arrays: it lacks the
   * read-only role the platform needs (Unisphere's Monitor role).
   */
  MissingRole = "MissingRole",
  // The server manages no array the account can see, or only remote ones.
  NoArrays = "NoArrays",
  // The server answered a request with an error the probe has no advice for.
  ApiError = "ApiError",
  // The collection took longer than its time budget.
  TimedOut = "TimedOut",
  // The collected data is larger than one upload to OneUptime may be.
  PayloadTooLarge = "PayloadTooLarge",
  /*
   * The probe is not allowed to collect this connection: it belongs to
   * another project, or it is a shared probe on OneUptime Cloud.
   */
  ProbeNotAllowed = "ProbeNotAllowed",
  /*
   * No probe picked the work up in time: the probe is offline, or runs a
   * OneUptime version older than storage array collection.
   */
  ProbeNotAvailable = "ProbeNotAvailable",
  // The probe cannot collect this platform (no poller for it).
  PlatformNotSupported = "PlatformNotSupported",
  // Anything else - a bug, with the detail in the message.
  Internal = "Internal",
}

export default StorageArrayCollectionErrorCode;

export class StorageArrayCollectionErrorCodeUtil {
  public static isValid(
    value: unknown,
  ): value is StorageArrayCollectionErrorCode {
    return (
      typeof value === "string" &&
      (Object.values(StorageArrayCollectionErrorCode) as Array<string>).includes(
        value,
      )
    );
  }

  // Codes a person fixes by trusting the certificate the report carries.
  public static isCertificateProblem(
    code: StorageArrayCollectionErrorCode | null | undefined,
  ): boolean {
    return (
      code === StorageArrayCollectionErrorCode.UntrustedCertificate ||
      code === StorageArrayCollectionErrorCode.CertificateChanged
    );
  }
}
