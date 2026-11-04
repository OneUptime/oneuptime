import { describePeerCertificate } from "../VMware/VSphereTls";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import VMwareCertificateFingerprint from "Common/Utils/VMware/VMwareCertificateFingerprint";
import https from "https";
import net from "net";
import tls, { DetailedPeerCertificate, PeerCertificate, TLSSocket } from "tls";

/*
 * How the probe decides it is talking to the cloud a person meant, before it sends
 * a single byte: the login with its secret, or a token. The rule is VSphereTls's.
 *
 * Every connection completes a full TLS handshake, and then exactly one of two rules
 * decides:
 *
 *   - no certificate trusted for this cloud: the certificate must chain to an
 *     authority this machine trusts AND name the host (Node's own chain and hostname
 *     verification);
 *   - certificates trusted (their SHA-256 fingerprints saved on the cloud): the
 *     certificate must be exactly one of them. Nothing else is accepted, a publicly
 *     signed one included, because a pin that a valid public certificate could
 *     override would protect nothing.
 *
 * What differs from a vCenter is that a cloud has many hosts. The catalog names one
 * URL per service, and each can have a certificate of its own, so the pin is a set
 * and a failure says which host showed what.
 *
 * Verification is never switched off: there is no "insecure" setting. What a person
 * can do instead is look at the certificate the API presented and trust that one,
 * the same decision as SSH's known_hosts, made once, in the open.
 *
 * The decision runs in the agent's createConnection: the socket reaches the HTTP
 * client only once it passed, so no request is ever written to an unverified peer.
 * The socket is connected to the address the probe validated (pinnedAddresses) and
 * never re-resolved, so DNS cannot be changed between the check and the connection.
 */

export interface OpenStackTlsTarget {
  // The host name (or IP) in the URL: SNI, and what the certificate must name.
  host: string;
  port: number;
  // The addresses the host was validated to, tried in order.
  pinnedAddresses: ReadonlyArray<string>;
  trustedFingerprints: ReadonlyArray<string>;
  connectTimeoutInMs: number;
}

export class OpenStackCertificateError extends Error {
  public readonly kind: "untrusted" | "changed";
  public readonly presentedCertificate: OpenStackPresentedCertificate;

  public constructor(data: {
    kind: "untrusted" | "changed";
    presentedCertificate: OpenStackPresentedCertificate;
    message: string;
  }) {
    super(data.message);
    this.name = "OpenStackCertificateError";
    this.kind = data.kind;
    this.presentedCertificate = data.presentedCertificate;
  }
}

export class OpenStackConnectTimeoutError extends Error {
  public readonly code: string = "ETIMEDOUT";

  public constructor(message: string) {
    super(message);
    this.name = "OpenStackConnectTimeoutError";
  }
}

/*
 * The verdict on a socket that finished its handshake: null to use it, or the error
 * that says why not. Exported for tests.
 */
export function judgeOpenStackCertificate(data: {
  authorized: boolean;
  authorizationError: string | null;
  certificate: PeerCertificate | DetailedPeerCertificate | null;
  trustedFingerprints: ReadonlyArray<string>;
  host: string;
  port: number;
}): OpenStackCertificateError | null {
  if (!data.certificate || !data.certificate.fingerprint256) {
    return new OpenStackCertificateError({
      kind: "untrusted",
      presentedCertificate: {
        fingerprint256: "",
        subject: "",
        issuer: "",
        isSelfSigned: false,
        verificationError: data.authorizationError || "no certificate",
        host: data.host,
        port: data.port,
      },
      message: `${data.host}:${data.port} presented no certificate.`,
    });
  }

  const presented: OpenStackPresentedCertificate = {
    ...describePeerCertificate(
      data.certificate,
      data.authorized ? null : data.authorizationError,
    ),
    host: data.host,
    port: data.port,
  };

  if (data.trustedFingerprints.length > 0) {
    const isTrusted: boolean = data.trustedFingerprints.some(
      (fingerprint: string): boolean => {
        return VMwareCertificateFingerprint.areEqual(
          fingerprint,
          presented.fingerprint256,
        );
      },
    );

    if (isTrusted) {
      return null;
    }

    return new OpenStackCertificateError({
      kind: "changed",
      presentedCertificate: presented,
      message: `${data.host}:${data.port} presented a certificate that is not one of those trusted for this cloud (SHA-256 ${presented.fingerprint256}). Nothing was sent. If it was renewed, or this service has a certificate of its own, check the new fingerprint and trust it.`,
    });
  }

  if (data.authorized) {
    return null;
  }

  return new OpenStackCertificateError({
    kind: "untrusted",
    presentedCertificate: presented,
    message: `${data.host}:${data.port}'s certificate is not trusted by the probe (${
      data.authorizationError || "verification failed"
    }). Issued to ${presented.subject || "an unnamed subject"} by ${
      presented.issuer || "an unnamed issuer"
    }, SHA-256 ${presented.fingerprint256}. Nothing was sent. Check this fingerprint against the API's certificate and trust it.`,
  });
}

// Connects to one address and resolves with a verified socket.
function connectAndVerify(
  target: OpenStackTlsTarget,
  address: string,
): Promise<TLSSocket> {
  return new Promise<TLSSocket>(
    (resolve: (socket: TLSSocket) => void, reject: (error: Error) => void) => {
      let isSettled: boolean = false;

      const isIpHost: boolean = net.isIP(target.host) !== 0;

      const socket: TLSSocket = tls.connect({
        host: address,
        port: target.port,
        // SNI and the hostname check use the name in the URL.
        ...(isIpHost ? {} : { servername: target.host }),
        /*
         * The decision is ours, made below before the socket is handed over: see
         * the top of this file. Node still runs its chain and hostname verification
         * and reports it in socket.authorized.
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
          new OpenStackConnectTimeoutError(
            `${target.host}:${target.port} did not complete a TLS connection within ${Math.round(
              target.connectTimeoutInMs / 1000,
            )} seconds.`,
          ),
        );
      }, target.connectTimeoutInMs);

      socket.once("error", onError);

      socket.once("secureConnect", () => {
        settle(
          judgeOpenStackCertificate({
            authorized: socket.authorized,
            authorizationError: socket.authorizationError
              ? String(socket.authorizationError)
              : null,
            certificate: socket.getPeerCertificate(false),
            trustedFingerprints: target.trustedFingerprints,
            host: target.host,
            port: target.port,
          }),
        );
      });
    },
  );
}

/*
 * Connects to the target's validated addresses in order and resolves with the first
 * verified socket. A certificate verdict ends the search at once: it is about the
 * API, not about one address.
 */
export async function openVerifiedSocket(
  target: OpenStackTlsTarget,
): Promise<TLSSocket> {
  let lastError: Error | null = null;

  for (const address of target.pinnedAddresses) {
    try {
      return await connectAndVerify(target, address);
    } catch (error) {
      if (error instanceof OpenStackCertificateError) {
        throw error;
      }

      /*
       * Kept as thrown, because its code (ECONNREFUSED ...) is what says what went
       * wrong, whatever realm made it.
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
 * An https.Agent whose every connection is opened by openVerifiedSocket. Keep-alive
 * reuses a verified socket for the next request of the same collection, and a socket
 * is never reused across hosts or collections: one agent per host per collection.
 */
export class OpenStackVerifyingAgent extends https.Agent {
  private readonly target: OpenStackTlsTarget;

  public constructor(target: OpenStackTlsTarget) {
    super({ keepAlive: true, maxSockets: 6 });
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
