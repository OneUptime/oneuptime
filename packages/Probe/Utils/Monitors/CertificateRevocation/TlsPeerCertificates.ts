import net from "net";
import tls, { DetailedPeerCertificate, TLSSocket } from "tls";

/*
 * The certificate a TLS server presented, the certificate that issued it, and
 * the OCSP response it stapled, if any: what the revocation check needs.
 */
export interface TlsPeerCertificateChain {
  certificate: Buffer;
  issuer?: Buffer | undefined;
  stapledOcspResponse?: Buffer | undefined;
}

export default class TlsPeerCertificates {
  /*
   * Reads the chain off a socket that has completed its handshake. Node links
   * each certificate to its issuer (issuerCertificate); a self-signed one
   * links to itself, which is no issuer to ask.
   */
  public static read(
    socket: TLSSocket,
    stapledOcspResponse?: Buffer | null | undefined,
  ): TlsPeerCertificateChain | undefined {
    const peer: DetailedPeerCertificate | undefined =
      socket.getPeerCertificate(true);

    if (!peer || !Buffer.isBuffer(peer.raw) || peer.raw.length === 0) {
      return undefined;
    }

    const issuer: DetailedPeerCertificate | undefined = peer.issuerCertificate;
    const issuerDer: Buffer | undefined =
      issuer && Buffer.isBuffer(issuer.raw) && !issuer.raw.equals(peer.raw)
        ? issuer.raw
        : undefined;

    return {
      certificate: peer.raw,
      issuer: issuerDer,
      stapledOcspResponse:
        stapledOcspResponse && stapledOcspResponse.length > 0
          ? stapledOcspResponse
          : undefined,
    };
  }
}

/*
 * Watches the TLS connections an HTTP agent opens for one monitor request and
 * keeps the chain of the connection that verified its peer. The OCSP response
 * arrives during the handshake, before 'secureConnect', so both listeners are
 * attached as soon as the socket exists.
 *
 * Only a peer Node verified (socket.authorized) is kept: a connection made
 * with verification turned off has nothing a revocation answer could add to.
 */
export class TlsPeerCertificateRecorder {
  private chain: TlsPeerCertificateChain | undefined = undefined;

  public attach(socket: net.Socket): void {
    if (!(socket instanceof tls.TLSSocket)) {
      return;
    }

    let stapledOcspResponse: Buffer | null = null;

    socket.on("OCSPResponse", (response: Buffer | null) => {
      stapledOcspResponse = response;
    });

    socket.once("secureConnect", () => {
      if (!socket.authorized) {
        return;
      }

      try {
        this.chain = TlsPeerCertificates.read(socket, stapledOcspResponse);
      } catch {
        // Diagnostics only: a certificate that cannot be read is not checked.
      }
    });
  }

  public getChain(): TlsPeerCertificateChain | undefined {
    return this.chain;
  }
}
