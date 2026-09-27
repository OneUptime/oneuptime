import ComponentCode, { RunOptions, RunReturnType } from "../ComponentCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components/Email";
import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import net from "net";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../Utils/DataSource/EgressGuard";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

// What nodemailer's getSocket hook hands back: an already connected socket.
type SmtpSocketCallback = (
  error: Error | null,
  socketOptions?: { connection: net.Socket },
) => void;

export default class Email extends ComponentCode {
  private static readonly CONNECTION_TIMEOUT_IN_MS: number = 2 * 60 * 1000;

  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = Components.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.SendEmail;
      },
    );

    if (!Component) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    if (!args["to"]) {
      throw options.onError(new BadDataException("To Email not found"));
    }

    if (args["to"] && typeof args["to"] !== "string") {
      throw options.onError(
        new BadDataException("To Email is not type of string"),
      );
    }

    if (!args["from"]) {
      throw options.onError(new BadDataException("From Email not found"));
    }

    if (args["from"] && typeof args["from"] !== "string") {
      throw options.onError(
        new BadDataException("From Email is not type of string"),
      );
    }

    if (args["smtp-username"] && typeof args["smtp-username"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Username is not type of string"),
      );
    }

    if (args["smtp-password"] && typeof args["smtp-password"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Password is not type of string"),
      );
    }

    if (!args["smtp-host"]) {
      throw options.onError(new BadDataException("SMTP Host not found"));
    }

    if (args["smtp-host"] && typeof args["smtp-host"] !== "string") {
      throw options.onError(
        new BadDataException("SMTP Host is not type of string"),
      );
    }

    if (!args["smtp-port"]) {
      throw options.onError(new BadDataException("SMTP Port not found"));
    }

    if (args["smtp-port"] && typeof args["smtp-port"] === "string") {
      args["smtp-port"] = parseInt(args["smtp-port"]);
    }

    if (args["smtp-port"] && typeof args["smtp-port"] !== "number") {
      throw options.onError(
        new BadDataException("SMTP Port is not type of number"),
      );
    }

    const username: string | undefined =
      args["smtp-username"]?.toString() || undefined;
    const password: string | undefined =
      args["smtp-password"]?.toString() || undefined;

    if (Boolean(username) !== Boolean(password)) {
      const errorMessage: string =
        "SMTP username and password must be provided together.";

      options.log(errorMessage);

      return {
        returnValues: { error: errorMessage },
        executePort: errorPort,
      };
    }

    const smtpHost: string = args["smtp-host"].toString().trim();
    // "[fd00::25]" is how an IPv6 literal is usually written next to a port.
    const bareSmtpHost: string = smtpHost.replace(/^\[|\]$/g, "");
    const smtpPort: number = args["smtp-port"] as number;

    try {
      /*
       * The SMTP host is free text typed into the workflow node by any
       * project member who can edit workflows, and nodemailer's failures
       * ("Invalid greeting. response=<banner>", refused vs timed out) come
       * back through the Error port into the workflow log. Unchecked, this
       * step is a port scanner with banner disclosure for whatever network
       * the workflow worker runs in.
       *
       * Same guard and label as a project's own SMTP server in MailService,
       * so the same policy: loopback, link-local and cloud metadata are
       * refused everywhere; private ranges are refused on SaaS and allowed on
       * self-hosted installs unless DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true.
       * A refusal is thrown inside this try, so it takes the Error port like
       * any other failure to send, before a socket is opened.
       */
      const validatedAddresses: Array<ResolvedAddress> =
        await DataSourceEgressGuard.assertHostnameAllowed(bareSmtpHost, {
          targetLabel: "SMTP server",
        });

      const smtpTransport: SMTPTransport.Options = {
        /*
         * nodemailer still needs the name the user typed: it is what TLS
         * sends as SNI and checks the certificate against, on implicit TLS
         * and on the STARTTLS upgrade alike. It is never dialed; see
         * getSocket.
         */
        host: bareSmtpHost,
        port: smtpPort,
        /*
         * Connect here, to the addresses just validated, and hand nodemailer
         * the open socket. Given the name instead, nodemailer resolves it
         * again on its own (dns.resolve4/6, then a process-wide five-minute
         * cache), so a DNS answer that changed after the check would choose
         * the address actually connected to.
         */
        getSocket: (
          _options: SMTPTransport.Options,
          callback: SmtpSocketCallback,
        ): void => {
          Email.connectToValidatedAddresses({
            host: bareSmtpHost,
            port: smtpPort,
            addresses: validatedAddresses,
            onDone: callback,
          });
        },
      };

      if (
        args["secure"] === true ||
        args["secure"] === "true" ||
        args["secure"] === 1
      ) {
        smtpTransport.secure = true;
      } else {
        smtpTransport.secure = false;
      }

      if (username && password) {
        smtpTransport.auth = {
          user: username,
          pass: password,
        };
      }

      const mailer: Transporter = nodemailer.createTransport(smtpTransport);

      await mailer.sendMail({
        from: args["from"].toString(),
        to: args["to"].toString(),
        subject: args["subject"]?.toString() || "",
        html: args["email-body"]?.toString() || "",
      });

      options.log("Email sent.");

      return Promise.resolve({
        returnValues: {},
        executePort: successPort,
      });
    } catch (err: unknown) {
      const errorMessage: string =
        err instanceof Error && err.message
          ? err.message
          : "Email could not be sent.";

      options.log(errorMessage);

      return Promise.resolve({
        returnValues: { error: errorMessage },
        executePort: errorPort,
      });
    }
  }

  /*
   * Open a TCP connection that can only reach the given, already validated
   * addresses, for nodemailer's getSocket hook: handed a connected socket,
   * nodemailer resolves and dials nothing itself.
   *
   * The pinned lookup answers with every validated address, and
   * autoSelectFamily tries them in turn, alternating families. That keeps
   * what nodemailer did when it resolved the name itself: a host whose
   * address family this worker cannot route (IPv4 on an IPv6-only cluster),
   * or one record that is down, falls through to the next address instead
   * of failing the send.
   */
  private static connectToValidatedAddresses(data: {
    host: string;
    port: number;
    addresses: Array<ResolvedAddress>;
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
      settle(Email.describeConnectionError(error));
    });
    socket.once("timeout", () => {
      settle(new Error("Connection timeout"));
    });
    // nodemailer's own default connection timeout.
    socket.setTimeout(Email.CONNECTION_TIMEOUT_IN_MS);
  }

  /*
   * When every address fails, autoSelectFamily reports an AggregateError
   * whose own message is empty, which would reach the workflow log as the
   * generic "Email could not be sent.". Name each attempt instead, the way
   * nodemailer's "connect ECONNREFUSED <ip>:<port>" did.
   */
  private static describeConnectionError(error: Error): Error {
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
