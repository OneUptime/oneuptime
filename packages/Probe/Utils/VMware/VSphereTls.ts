import { VMwarePresentedCertificate } from "Common/Types/VMware/VMwareProbeCollection";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import https from "https";
import net from "net";
import tls, { DetailedPeerCertificate, PeerCertificate, TLSSocket } from "tls";

/*
 * How the probe decides it is talking to the vCenter a person meant, before
 * it sends a single byte - the login with its password included.
 *
 * Every connection completes a full TLS handshake, and then exactly one of
 * two rules decides:
 *
 *   - no certificate trusted for this vCenter: the certificate must chain to
 *     an authority this machine trusts AND name the host (Node's own chain
 *     and hostname verification);
 *   - a certificate trusted (its SHA-256 fingerprint saved on the vCenter):
 *     the certificate must be exactly that one. Nothing else is accepted, a
 *     publicly signed one included - a pin that a valid public certificate
 *     could override would protect nothing.
 *
 * Verification is never switched off: there is no "insecure" setting. What
 * a person can do instead is look at the certificate vCenter presented
 * (VMwarePresentedCertificate, sent back with the failure) and trust that
 * one - the same decision as SSH's known_hosts, made once, in the open.
 *
 * The decision runs in the agent's createConnection: the socket reaches the
 * HTTP client only once it passed, so no request - and no password - is
 * ever written to an unverified peer. The socket is connected to the
 * address the probe validated (pinnedAddresses), never re-resolved, so DNS
 * cannot be changed between the check and the connection.
 */

export interface VSphereTlsTarget {
  // The host name (or IP) a person typed: SNI, and what the certificate must name.
  host: string;
  port: number;
  // The addresses the host was validated to, tried in order.
  pinnedAddresses: Array<string>;
  trustedFingerprint: string | null;
  connectTimeoutInMs: number;
}

export class VSphereCertificateError extends Error {
  public readonly kind: "untrusted" | "changed";
  public readonly presentedCertificate: VMwarePresentedCertificate;

  public constructor(data: {
    kind: "untrusted" | "changed";
    presentedCertificate: VMwarePresentedCertificate;
    message: string;
  }) {
    super(data.message);
    this.name = "VSphereCertificateError";
    this.kind = data.kind;
    this.presentedCertificate = data.presentedCertificate;
  }
}

export class VSphereConnectTimeoutError extends Error {
  public readonly code: string = "ETIMEDOUT";

  public constructor(message: string) {
    super(message);
    this.name = "VSphereConnectTimeoutError";
  }
}

function formatDistinguishedName(
  name: Record<string, string | Array<string>> | undefined,
): string {
  if (!name) {
    return "";
  }

  const order: Array<string> = ["CN", "OU", "O", "L", "ST", "C"];
  const parts: Array<string> = [];

  for (const key of order) {
    const value: string | Array<string> | undefined = name[key];

    if (value === undefined) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      parts.push(`${key}=${item}`);
    }
  }

  return parts.join(", ");
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// What a person needs to decide whether to trust the certificate.
export function describePeerCertificate(
  certificate: PeerCertificate | DetailedPeerCertificate,
  verificationError: string | null,
): VMwarePresentedCertificate {
  const subject: string = formatDistinguishedName(
    certificate.subject as unknown as Record<string, string>,
  );
  const issuer: string = formatDistinguishedName(
    certificate.issuer as unknown as Record<string, string>,
  );

  const presented: VMwarePresentedCertificate = {
    fingerprint256:
      VMwareCertificateFingerprint.normalize(certificate.fingerprint256) ||
      certificate.fingerprint256 ||
      "",
    subject: subject,
    issuer: issuer,
    isSelfSigned: Boolean(subject) && subject === issuer,
  };

  const validFrom: string | undefined = toIsoDate(certificate.valid_from);
  const validTo: string | undefined = toIsoDate(certificate.valid_to);

  if (validFrom) {
    presented.validFrom = validFrom;
  }

  if (validTo) {
    presented.validTo = validTo;
  }

  if (certificate.subjectaltname) {
    presented.subjectAltName = certificate.subjectaltname;
  }

  if (verificationError) {
    presented.verificationError = verificationError;
  }

  return presented;
}

/*
 * The verdict on a socket that finished its handshake: null to use it, or
 * the error that says why not. Exported for tests.
 */
export function judgePeerCertificate(data: {
  authorized: boolean;
  authorizationError: string | null;
  certificate: PeerCertificate | DetailedPeerCertificate | null;
  trustedFingerprint: string | null;
  host: string;
}): VSphereCertificateError | null {
  if (!data.certificate || !data.certificate.fingerprint256) {
    return new VSphereCertificateError({
      kind: "untrusted",
      presentedCertificate: {
        fingerprint256: "",
        subject: "",
        issuer: "",
        isSelfSigned: false,
        verificationError: data.authorizationError || "no certificate",
      },
      message: `${data.host} presented no certificate.`,
    });
  }

  const presented: VMwarePresentedCertificate = describePeerCertificate(
    data.certificate,
    data.authorized ? null : data.authorizationError,
  );

  if (data.trustedFingerprint) {
    if (
      VMwareCertificateFingerprint.areEqual(
        data.trustedFingerprint,
        presented.fingerprint256,
      )
    ) {
      return null;
    }

    return new VSphereCertificateError({
      kind: "changed",
      presentedCertificate: presented,
      message: `${data.host} presented a different certificate from the one trusted for it (SHA-256 ${presented.fingerprint256}, trusted ${VMwareCertificateFingerprint.normalize(data.trustedFingerprint)}). Nothing was sent. If vCenter's certificate was renewed, check the new fingerprint and trust it.`,
    });
  }

  if (data.authorized) {
    return null;
  }

  return new VSphereCertificateError({
    kind: "untrusted",
    presentedCertificate: presented,
    message: `${data.host}'s certificate is not trusted by the probe (${
      data.authorizationError || "verification failed"
    }). Issued to ${presented.subject || "an unnamed subject"} by ${
      presented.issuer || "an unnamed issuer"
    }, SHA-256 ${presented.fingerprint256}. Nothing was sent. Check this fingerprint against vCenter's certificate and trust it.`,
  });
}

// Connects to one address and resolves with a verified socket.
function connectAndVerify(
  target: VSphereTlsTarget,
  address: string,
): Promise<TLSSocket> {
  return new Promise<TLSSocket>(
    (resolve: (socket: TLSSocket) => void, reject: (error: Error) => void) => {
      let isSettled: boolean = false;

      const isIpHost: boolean = net.isIP(target.host) !== 0;

      const socket: TLSSocket = tls.connect({
        host: address,
        port: target.port,
        // SNI and the hostname check use the name the person typed.
        ...(isIpHost ? {} : { servername: target.host }),
        /*
         * The decision is ours, made below before the socket is handed
         * over - see the top of this file. Node still runs its chain and
         * hostname verification and reports it in socket.authorized.
         */
        rejectUnauthorized: false,
        checkServerIdentity: (
          _hostname: string,
          certificate: PeerCertificate,
        ): Error | undefined => {
          return tls.checkServerIdentity(target.host, certificate);
        },
        minVersion: "TLSv1.2",
        ALPNProtocols: ["http/1.1"],
      });

      const settle: (error: Error | null) => void = (
        error: Error | null,
      ): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(timer);
        socket.removeListener("error", onError);

        if (error) {
          socket.destroy();
          reject(error);
          return;
        }

        resolve(socket);
      };

      const onError: (error: Error) => void = (error: Error): void => {
        settle(error);
      };

      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        settle(
          new VSphereConnectTimeoutError(
            `${target.host}:${target.port} did not complete a TLS connection within ${Math.round(
              target.connectTimeoutInMs / 1000,
            )} seconds.`,
          ),
        );
      }, target.connectTimeoutInMs);

      socket.once("error", onError);

      socket.once("secureConnect", () => {
        const verdict: VSphereCertificateError | null = judgePeerCertificate({
          authorized: socket.authorized,
          authorizationError: socket.authorizationError
            ? String(socket.authorizationError)
            : null,
          certificate: socket.getPeerCertificate(false),
          trustedFingerprint: target.trustedFingerprint,
          host: target.host,
        });

        settle(verdict);
      });
    },
  );
}

/*
 * Connects to the target's validated addresses in order and resolves with
 * the first verified socket. A certificate verdict ends the search at once:
 * it is about vCenter, not about one address.
 */
export async function openVerifiedSocket(
  target: VSphereTlsTarget,
): Promise<TLSSocket> {
  let lastError: Error | null = null;

  for (const address of target.pinnedAddresses) {
    try {
      return await connectAndVerify(target, address);
    } catch (error) {
      if (error instanceof VSphereCertificateError) {
        throw error;
      }

      /*
       * Kept as thrown - its code (ECONNREFUSED ...) is what says what went
       * wrong - whatever realm made it.
       */
      lastError =
        error && typeof error === "object"
          ? (error as Error)
          : new Error(String(error));
    }
  }

  throw lastError || new Error(`${target.host} has no address to connect to.`);
}

/*
 * An https.Agent whose every connection is opened by openVerifiedSocket.
 * Keep-alive reuses a verified socket for the next request of the same
 * collection; a socket is never reused across vCenters (one agent per
 * collection).
 */
export class VSphereVerifyingAgent extends https.Agent {
  private readonly target: VSphereTlsTarget;

  public constructor(target: VSphereTlsTarget) {
    super({ keepAlive: true, maxSockets: 4 });
    this.target = target;
  }

  public override createConnection(
    _options: unknown,
    callback?: (error: Error | null, socket: net.Socket) => void,
  ): net.Socket | undefined {
    openVerifiedSocket(this.target)
      .then((socket: TLSSocket) => {
        callback?.(null, socket);
      })
      .catch((error: Error) => {
        callback?.(error, undefined as unknown as net.Socket);
      });

    return undefined;
  }
}
