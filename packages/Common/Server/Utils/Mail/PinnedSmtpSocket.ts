import net from "net";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../DataSource/EgressGuard";

// What nodemailer's getSocket hook hands back: an already connected socket.
export type SmtpSocketCallback = (
  error: Error | null,
  socketOptions?: { connection: net.Socket },
) => void;

/*
 * The socket half of pinning a tenant-chosen SMTP server to the addresses
 * the egress guard validated.
 *
 * Given a host name, nodemailer resolves it again on its own (dns.resolve4/6,
 * falling back to dns.lookup, behind a process-wide cache kept for five
 * minutes whatever the record's TTL), so a DNS answer that changed after the
 * check would choose the address actually connected to. Callers validate the
 * host, open the socket here, and hand it to nodemailer through its getSocket
 * hook as `{ connection: socket }`; nodemailer then resolves and dials
 * nothing itself.
 *
 * nodemailer still gets the name the user typed as `host`: it is what TLS
 * sends as SNI and checks the certificate against, on implicit TLS and on the
 * STARTTLS upgrade alike.
 *
 * Used by the workflow Send Email component and by MailService for project
 * SMTP configs.
 */
export default class PinnedSmtpSocket {
  /*
   * Open a TCP connection that can only reach the given, already validated
   * addresses.
   *
   * The pinned lookup answers with every validated address, and
   * autoSelectFamily tries them in turn, alternating families. That keeps
   * what nodemailer did when it resolved the name itself: a host whose
   * address family this worker cannot route (IPv4 on an IPv6-only cluster),
   * or one record that is down, falls through to the next address instead
   * of failing the send.
   *
   * timeoutInMs bounds the TCP connect. nodemailer's own connectionTimeout
   * only starts once it is handed the connected socket, so without this a
   * blackholed address would hang the send.
   */
  public static connect(data: {
    host: string;
    port: number;
    addresses: Array<ResolvedAddress>;
    timeoutInMs: number;
    onDone: SmtpSocketCallback;
  }): void {
    const socket: net.Socket = net.connect({
      host: data.host,
      port: data.port,
      lookup: DataSourceEgressGuard.createPinnedLookup(data.addresses) as never,
      autoSelectFamily: true,
    });

    let settled: boolean = false;

    const settle: (error: Error | null) => void = (
      error: Error | null,
    ): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.setTimeout(0);

      if (error) {
        // A late error from a socket nobody owns would crash the process.
        socket.on("error", () => {});
        socket.destroy();
        data.onDone(error);
        return;
      }

      /*
       * nodemailer attaches its own error and timeout handlers synchronously
       * inside this callback, so the socket is never left unwatched. The
       * listeners below stay behind as no-ops.
       */
      data.onDone(null, { connection: socket });
    };

    socket.once("connect", () => {
      settle(null);
    });
    socket.once("error", (error: Error) => {
      settle(PinnedSmtpSocket.describeConnectionError(error));
    });
    socket.once("timeout", () => {
      settle(new Error("Connection timeout"));
    });
    socket.setTimeout(data.timeoutInMs);
  }

  /*
   * When every address fails, autoSelectFamily reports an AggregateError
   * whose own message is empty, which would reach the user as a generic
   * "could not be sent". Name each attempt instead, the way nodemailer's
   * "connect ECONNREFUSED <ip>:<port>" did.
   */
  public static describeConnectionError(error: Error): Error {
    const attempts: unknown = (error as { errors?: unknown }).errors;

    if (error.message || !Array.isArray(attempts) || attempts.length === 0) {
      return error;
    }

    const described: NodeJS.ErrnoException = new Error(
      attempts
        .map((attempt: unknown) => {
          const message: unknown = (attempt as { message?: unknown } | null)
            ?.message;
          return typeof message === "string" ? message : String(attempt);
        })
        .join("; "),
    );
    const code: string | undefined = (error as NodeJS.ErrnoException).code;
    if (code) {
      described.code = code;
    }

    return described;
  }
}
