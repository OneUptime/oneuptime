import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../DataSource/EgressGuard";
import IRCMessageUtil, { IRCMessage } from "./IRCMessage";
import crypto from "crypto";
import net from "net";
import tls from "tls";

/*
 * Delivers one message to an IRC channel or nickname, the way a person's
 * client would, and hangs up: connect, register, sign in, join, send, check
 * that the server took it, quit.
 *
 * IRC has no HTTP API and no webhooks, so unlike the other chat steps this
 * one speaks the protocol itself, over a socket to a server the workflow's
 * author chose. Three things follow from that, and each is handled here:
 *
 *   - The server is chosen by a tenant. The caller validates it with the
 *     egress guard and hands over the addresses it approved; the socket can
 *     reach those and nothing else, so DNS cannot be asked a second time and
 *     answer differently (the same pinning as the Send Email step's SMTP
 *     socket). Every line this client sends starts with a command it chose,
 *     and nothing a tenant writes can start a line, so the connection cannot
 *     be pointed at another protocol's command set either.
 *
 *   - IRC never says "delivered". A failed PRIVMSG is answered with an error
 *     numeric and a successful one with nothing, so after the last line the
 *     client sends a PING and waits for its PONG: a server answers in order,
 *     so by then any refusal of the message has already arrived.
 *
 *   - What comes back is shown to the author on the Error port. Only what an
 *     IRC server says in IRC - an error reply's text - is ever quoted. A
 *     reply that is not IRC at all (a web server's, an SSH banner) is
 *     reported as "did not answer like an IRC server", without the bytes, so
 *     the step cannot be used to read the banners of other services.
 */

export class IRCError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IRCError";
  }
}

export interface IRCSASLCredentials {
  username: string;
  password: string;
}

export interface IRCPacing {
  // Lines sent at once before the client starts to wait between them.
  burst: number;
  intervalInMs: number;
}

export interface IRCSendOptions {
  /*
   * The server as typed, without brackets around an IPv6 address. It is what
   * TLS sends as SNI and checks the certificate against. It is never looked
   * up: the socket goes to `addresses`.
   */
  host: string;
  port: number;
  // What the egress guard approved for `host`. The only places dialed.
  addresses: Array<ResolvedAddress>;
  useTls: boolean;
  // Tried in turn while the server says the one before is taken.
  nicknames: Array<string>;
  // A channel, or the nickname of the person to message.
  target: string;
  joinChannel: boolean;
  channelKey?: string | undefined;
  serverPassword?: string | undefined;
  sasl?: IRCSASLCredentials | undefined;
  // Already split to fit (IRCMessageText.prepare).
  lines: Array<string>;
  // For everything, from connecting to quitting.
  timeoutInMs: number;
  pacing?: IRCPacing | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface IRCSendResult {
  // The nickname the message was sent as.
  nickname: string;
  linesSent: number;
}

/*
 * About what irssi and WeeChat do: a few lines at once, then one a second.
 * Servers throttle (Ergo, InspIRCd) or disconnect ("Excess Flood") a client
 * that sends faster than that for long.
 */
export const IRC_DEFAULT_PACING: IRCPacing = {
  burst: 4,
  intervalInMs: 1000,
};

// IRCv3 allows 8191 bytes of message tags in front of a 512-byte line.
const MAX_INCOMING_LINE_BYTES: number = 8191 + 512;

/*
 * A big channel's member list and a long MOTD are tens of kilobytes. A server
 * that sends far more than that is not one this step needs to keep reading.
 */
const MAX_INCOMING_BYTES: number = 1024 * 1024;

// How long QUIT may take before the socket is closed anyway.
const QUIT_GRACE_IN_MS: number = 2000;

// The longest reply text quoted back to the author.
const MAX_QUOTED_REPLY_LENGTH: number = 200;

// IRC formatting: a colour by number (\x03) and by hex (\x04).
const COLOR_CODE: number = 0x03;
const HEX_COLOR_CODE: number = 0x04;

// RFC 4616 SASL PLAIN, sent in pieces of at most 400 bytes (IRCv3 SASL 3.1).
const SASL_CHUNK_LENGTH: number = 400;

const USERNAME: string = "oneuptime";
const REAL_NAME: string = "OneUptime";
const QUIT_MESSAGE: string = "Sent from OneUptime";

enum Phase {
  Connecting = "Connecting",
  Registering = "Registering",
  Joining = "Joining",
  Sending = "Sending",
  Confirming = "Confirming",
  Quitting = "Quitting",
}

// A refusal of the connection, the nickname or a password, before 001.
const NICKNAME_TAKEN_REPLIES: ReadonlySet<string> = new Set<string>([
  "433", // ERR_NICKNAMEINUSE
  "436", // ERR_NICKCOLLISION
  "437", // ERR_UNAVAILRESOURCE
]);

const SASL_FAILURE_REPLIES: ReadonlySet<string> = new Set<string>([
  "902", // ERR_NICKLOCKED
  "904", // ERR_SASLFAIL
  "905", // ERR_SASLTOOLONG
  "906", // ERR_SASLABORTED
]);

// Why a JOIN did not happen.
const JOIN_FAILURE_REPLIES: ReadonlySet<string> = new Set<string>([
  "403", // ERR_NOSUCHCHANNEL
  "405", // ERR_TOOMANYCHANNELS
  "437", // ERR_UNAVAILRESOURCE
  "470", // ERR_LINKCHANNEL: forwarded to another channel
  "471", // ERR_CHANNELISFULL
  "473", // ERR_INVITEONLYCHAN
  "474", // ERR_BANNEDFROMCHAN
  "475", // ERR_BADCHANNELKEY
  "476", // ERR_BADCHANMASK
  "477", // ERR_NEEDREGGEDNICK
  "479", // ERR_BADCHANNAME
  "489", // ERR_SECUREONLYCHAN
  "520", // ERR_OPERONLY
]);

// Why a PRIVMSG was not delivered.
const SEND_FAILURE_REPLIES: ReadonlySet<string> = new Set<string>([
  "401", // ERR_NOSUCHNICK
  "402", // ERR_NOSUCHSERVER
  "403", // ERR_NOSUCHCHANNEL
  "404", // ERR_CANNOTSENDTOCHAN
  "407", // ERR_TOOMANYTARGETS
  "411", // ERR_NORECIPIENT
  "412", // ERR_NOTEXTTOSEND
  "413", // ERR_NOTOPLEVEL
  "414", // ERR_WILDTOPLEVEL
  "477", // ERR_NEEDREGGEDNICK
  "486", // ERR_NONONREG: the person takes messages from signed-in users only
  "531", // ERR_CANTSENDTOUSER
  "716", // ERR_TARGUMODEG: the person only takes messages from people they allowed
]);

interface PendingOperation {
  reject: (error: Error) => void;
}

interface MessageWaiter {
  handle: (message: IRCMessage) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

export default class IRCClient {
  public static async sendMessage(
    options: IRCSendOptions,
  ): Promise<IRCSendResult> {
    return await new IRCSession(options).run();
  }

  /*
   * The nicknames tried for `nickname`, in order: itself, then with "_" and
   * "__", then with a number. The number is the last resort, so two runs at
   * the same moment rarely end up as the same nickname.
   */
  public static getNicknameCandidates(nickname: string): Array<string> {
    const number: number = 100 + crypto.randomInt(900);

    return [nickname, `${nickname}_`, `${nickname}__`, `${nickname}${number}`];
  }

  // The longest of getNicknameCandidates(nickname), to size lines for.
  public static getLongestNicknameCandidate(nickname: string): string {
    return `${nickname}000`;
  }

  /*
   * A server's words, made fit to quote: formatting codes and other control
   * characters removed - a colour code with the colour numbers after it -
   * and cut to a sentence's length.
   */
  public static cleanServerText(text: string): string {
    let cleaned: string = "";
    let index: number = 0;

    while (index < text.length) {
      const code: number = text.charCodeAt(index);
      index++;

      if (code === COLOR_CODE) {
        // \x03, then a colour of up to two digits, and ",background" if any.
        index = IRCClient.skipColor(text, index, 2, IRCClient.isDigit);
      } else if (code === HEX_COLOR_CODE) {
        index = IRCClient.skipColor(text, index, 6, IRCClient.isHexDigit);
      }

      if (code < 0x20 || code === 0x7f) {
        continue;
      }

      cleaned += String.fromCharCode(code);

      if (cleaned.length >= MAX_QUOTED_REPLY_LENGTH) {
        return `${cleaned.trim()}…`;
      }
    }

    return cleaned.trim();
  }

  // The human-readable part of a reply: its last parameter.
  public static describeReply(message: IRCMessage): string {
    const text: string =
      message.params.length > 0
        ? (message.params[message.params.length - 1] as string)
        : "";

    return IRCClient.cleanServerText(text) || `reply ${message.command}`;
  }

  // Past a colour: up to `length` characters, then "," and as many again.
  private static skipColor(
    text: string,
    start: number,
    length: number,
    isColorCharacter: (character: string) => boolean,
  ): number {
    const skip: (from: number) => number = (from: number): number => {
      let end: number = from;

      while (end - from < length && isColorCharacter(text.charAt(end))) {
        end++;
      }

      return end;
    };

    const end: number = skip(start);

    if (
      end > start &&
      text.charAt(end) === "," &&
      isColorCharacter(text.charAt(end + 1))
    ) {
      return skip(end + 1);
    }

    return end;
  }

  private static isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }

  private static isHexDigit(character: string): boolean {
    return (
      IRCClient.isDigit(character) ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F")
    );
  }
}

class IRCSession {
  private readonly options: IRCSendOptions;
  private socket: net.Socket | null = null;
  private rawSocket: net.Socket | null = null;

  private phase: Phase = Phase.Connecting;
  private failure: Error | null = null;
  private isFinished: boolean = false;

  private incoming: Buffer = Buffer.alloc(0);
  private incomingBytes: number = 0;
  private hasHeardIRC: boolean = false;
  private received: Array<IRCMessage> = [];
  private waiter: MessageWaiter | null = null;
  private pending: Set<PendingOperation> = new Set<PendingOperation>();

  // Fails the session on a reply that means the message was refused.
  private replyCheck: ((message: IRCMessage) => Error | null) | null = null;

  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: Set<ReturnType<typeof setTimeout>> = new Set<
    ReturnType<typeof setTimeout>
  >();

  private nicknameIndex: number = 0;
  private nickname: string;

  public constructor(options: IRCSendOptions) {
    if (options.nicknames.length === 0) {
      throw new IRCError("No nickname to connect as.");
    }

    this.options = options;
    this.nickname = options.nicknames[0] as string;
  }

  public async run(): Promise<IRCSendResult> {
    this.deadlineTimer = setTimeout(() => {
      this.fail(this.getTimeoutError());
    }, this.options.timeoutInMs);

    try {
      await this.connect();
      await this.register();

      if (this.options.joinChannel) {
        await this.join();
      }

      const linesSent: number = await this.sendLines();

      await this.quit();

      return { nickname: this.nickname, linesSent: linesSent };
    } finally {
      this.isFinished = true;
      this.cleanUp();
    }
  }

  private get serverName(): string {
    const host: string = net.isIPv6(this.options.host)
      ? `[${this.options.host}]`
      : this.options.host;

    return `${host}:${this.options.port}`;
  }

  /*
   * ---------------------------------------------------------------- Connect
   */

  private async connect(): Promise<void> {
    this.phase = Phase.Connecting;

    this.log(
      `Connecting to the IRC server ${this.serverName}${
        this.options.useTls ? " over TLS" : " without TLS"
      }.`,
    );

    const rawSocket: net.Socket = await this.track<net.Socket>(
      (
        resolve: (socket: net.Socket) => void,
        reject: (error: Error) => void,
      ) => {
        const socket: net.Socket = net.connect({
          host: this.options.host,
          port: this.options.port,
          lookup: DataSourceEgressGuard.createPinnedLookup(
            this.options.addresses,
          ) as never,
          autoSelectFamily: true,
        });

        this.rawSocket = socket;

        socket.once("connect", () => {
          resolve(socket);
        });

        socket.once("error", (error: Error) => {
          reject(
            new IRCError(
              `Could not connect to the IRC server ${this.serverName}: ${IRCSession.describeConnectionError(error)}.`,
            ),
          );
        });
      },
    );

    // A late error on a socket nobody listens to would crash the process.
    rawSocket.on("error", () => {});

    this.socket = this.options.useTls
      ? await this.startTls(rawSocket)
      : rawSocket;

    this.socket.on("data", (chunk: Buffer) => {
      this.onData(chunk);
    });

    this.socket.on("error", (error: Error) => {
      this.onConnectionLost(error);
    });

    this.socket.on("close", () => {
      this.onConnectionLost(null);
    });
  }

  private async startTls(rawSocket: net.Socket): Promise<tls.TLSSocket> {
    const isAddress: boolean = net.isIP(this.options.host) !== 0;

    return await this.track<tls.TLSSocket>(
      (
        resolve: (socket: tls.TLSSocket) => void,
        reject: (error: Error) => void,
      ) => {
        const secureSocket: tls.TLSSocket = tls.connect({
          socket: rawSocket,
          // The certificate is checked against this, and an address has no SNI.
          host: this.options.host,
          servername: isAddress ? undefined : this.options.host,
          rejectUnauthorized: true,
        });

        this.socket = secureSocket;

        secureSocket.once("secureConnect", () => {
          resolve(secureSocket);
        });

        secureSocket.once("error", (error: Error) => {
          reject(this.describeTlsError(error));
        });
      },
    );
  }

  private describeTlsError(error: Error): IRCError {
    const code: string = (error as NodeJS.ErrnoException).code || "";
    const isCertificateProblem: boolean =
      code.includes("CERT") ||
      code.includes("SIGNED") ||
      code.includes("VERIFY") ||
      code.includes("ALTNAME");

    if (isCertificateProblem) {
      return new IRCError(
        `The TLS certificate of the IRC server ${this.serverName} is not trusted: ${error.message}. A self-hosted OneUptime can trust a private certificate authority through NODE_EXTRA_CA_CERTS.`,
      );
    }

    return new IRCError(
      `Could not start TLS with the IRC server ${this.serverName}: ${error.message}. Check Port: 6697 is the usual port for TLS, and 6667 for connections without it.`,
    );
  }

  /*
   * Node reports "every address failed" as an AggregateError whose own
   * message is empty. Name each attempt instead.
   */
  private static describeConnectionError(error: Error): string {
    const attempts: unknown = (error as { errors?: unknown }).errors;

    if (error.message || !Array.isArray(attempts) || attempts.length === 0) {
      return error.message || "the connection failed";
    }

    return attempts
      .map((attempt: unknown) => {
        const message: unknown = (attempt as { message?: unknown } | null)
          ?.message;
        return typeof message === "string" ? message : String(attempt);
      })
      .join("; ");
  }

  /*
   * --------------------------------------------------------------- Register
   */

  private async register(): Promise<void> {
    this.phase = Phase.Registering;

    const sasl: IRCSASLCredentials | undefined = this.options.sasl;

    /*
     * Asking for the server's capabilities first holds registration open
     * until CAP END, so the sign-in can finish before the server lets the
     * connection in. Without SASL there is nothing to ask for.
     */
    if (sasl) {
      this.send({ command: "CAP", middle: ["LS", "302"] });
    }

    const serverPassword: string | undefined = this.options.serverPassword;

    if (serverPassword) {
      // As a plain parameter where it can be one, which every server reads.
      this.send(
        IRCMessageUtil.isSafeMiddleParam(serverPassword)
          ? { command: "PASS", middle: [serverPassword] }
          : { command: "PASS", trailing: serverPassword },
      );
    }

    this.send({ command: "NICK", middle: [this.nickname] });
    this.send({
      command: "USER",
      middle: [USERNAME, "0", "*"],
      trailing: REAL_NAME,
    });

    let capabilities: Array<string> = [];
    let isSignedIn: boolean = false;

    await this.waitFor((message: IRCMessage): boolean => {
      switch (message.command) {
        case "001": {
          if (sasl && !isSignedIn) {
            throw new IRCError(
              `The IRC server ${this.serverName} does not support SASL. Remove SASL Username and SASL Password, or use Server Password if the server takes one.`,
            );
          }

          // RPL_WELCOME is addressed to the nickname the server gave us.
          this.nickname = message.params[0] || this.nickname;
          return true;
        }

        case "CAP": {
          if (!sasl) {
            return false;
          }

          const subcommand: string = (message.params[1] || "").toUpperCase();

          if (subcommand === "LS") {
            // "CAP * LS * :..." means more of the list is coming.
            const isLastLine: boolean = message.params[2] !== "*";
            capabilities = capabilities.concat(
              (message.params[message.params.length - 1] || "")
                .split(" ")
                .filter((capability: string) => {
                  return capability.length > 0;
                }),
            );

            if (isLastLine) {
              this.requestSasl(capabilities);
            }
          } else if (subcommand === "ACK") {
            this.send({ command: "AUTHENTICATE", middle: ["PLAIN"] });
          } else if (subcommand === "NAK") {
            throw new IRCError(
              `The IRC server ${this.serverName} refused to start SASL.`,
            );
          }

          return false;
        }

        case "AUTHENTICATE": {
          if (sasl && message.params[0] === "+") {
            this.sendSaslCredentials(sasl);
          }

          return false;
        }

        // RPL_SASLSUCCESS, and ERR_SASLALREADY: signed in either way.
        case "903":
        case "907": {
          isSignedIn = true;
          this.log(`Signed in with SASL as ${JSON.stringify(sasl?.username)}.`);
          this.send({ command: "CAP", middle: ["END"] });
          return false;
        }

        // ERR_UNKNOWNCOMMAND, for a server that has never heard of CAP.
        case "421": {
          if (sasl && (message.params[1] || "").toUpperCase() === "CAP") {
            throw new IRCError(
              `The IRC server ${this.serverName} does not support SASL. Remove SASL Username and SASL Password, or use Server Password if the server takes one.`,
            );
          }

          return false;
        }

        // ERR_ERRONEUSNICKNAME
        case "432": {
          throw new IRCError(
            `The IRC server refused the nickname ${JSON.stringify(this.nickname)}: ${IRCClient.describeReply(message)}. Set another Nickname.`,
          );
        }

        // ERR_PASSWDMISMATCH
        case "464": {
          throw new IRCError(
            `The IRC server refused the connection: ${IRCClient.describeReply(message)}. ${
              this.options.serverPassword
                ? "Check Server Password."
                : "It needs a password: fill in Server Password."
            }`,
          );
        }

        // ERR_NOPERMFORHOST, ERR_YOUREBANNEDCREEP
        case "463":
        case "465": {
          throw new IRCError(
            `The IRC server refused the connection: ${IRCClient.describeReply(message)}.`,
          );
        }

        default: {
          if (NICKNAME_TAKEN_REPLIES.has(message.command)) {
            this.tryNextNickname();
          } else if (SASL_FAILURE_REPLIES.has(message.command)) {
            throw new IRCError(
              `SASL sign-in failed: ${IRCClient.describeReply(message)}. Check SASL Username and SASL Password.`,
            );
          }

          return false;
        }
      }
    });

    this.log(
      `Registered with the IRC server as ${JSON.stringify(this.nickname)}.`,
    );
  }

  private requestSasl(capabilities: Array<string>): void {
    const sasl: string | undefined = capabilities.find((capability: string) => {
      return capability === "sasl" || capability.startsWith("sasl=");
    });

    if (!sasl) {
      throw new IRCError(
        `The IRC server ${this.serverName} does not offer SASL. Remove SASL Username and SASL Password, or use Server Password if the server takes one.`,
      );
    }

    // "sasl=PLAIN,EXTERNAL" lists the mechanisms; a bare "sasl" does not.
    const mechanisms: Array<string> = sasl.includes("=")
      ? sasl
          .substring(sasl.indexOf("=") + 1)
          .toUpperCase()
          .split(",")
      : [];

    if (mechanisms.length > 0 && !mechanisms.includes("PLAIN")) {
      throw new IRCError(
        `The IRC server ${this.serverName} does not offer SASL PLAIN, which is the sign-in this step uses. It offers ${mechanisms.join(", ")}.`,
      );
    }

    this.send({ command: "CAP", middle: ["REQ"], trailing: "sasl" });
  }

  private sendSaslCredentials(sasl: IRCSASLCredentials): void {
    // authzid, authcid and password, separated by NUL (RFC 4616).
    const payload: string = Buffer.from(
      `${sasl.username}\0${sasl.username}\0${sasl.password}`,
      "utf8",
    ).toString("base64");

    for (
      let start: number = 0;
      start < payload.length;
      start += SASL_CHUNK_LENGTH
    ) {
      this.send({
        command: "AUTHENTICATE",
        middle: [payload.substring(start, start + SASL_CHUNK_LENGTH)],
      });
    }

    // A last piece of exactly 400 bytes is followed by "+": nothing more.
    if (payload.length % SASL_CHUNK_LENGTH === 0) {
      this.send({ command: "AUTHENTICATE", middle: ["+"] });
    }
  }

  private tryNextNickname(): void {
    this.nicknameIndex++;

    const next: string | undefined = this.options.nicknames[this.nicknameIndex];

    if (!next) {
      throw new IRCError(
        `Every nickname tried is taken on this IRC server: ${this.options.nicknames.join(", ")}. Set another Nickname.`,
      );
    }

    this.log(
      `The nickname ${JSON.stringify(this.nickname)} is taken. Trying ${JSON.stringify(next)}.`,
    );

    this.nickname = next;
    this.send({ command: "NICK", middle: [next] });
  }

  /*
   * ------------------------------------------------------------------- Join
   */

  private async join(): Promise<void> {
    this.phase = Phase.Joining;

    const channel: string = this.options.target;

    this.send({
      command: "JOIN",
      middle: this.options.channelKey
        ? [channel, this.options.channelKey]
        : [channel],
    });

    await this.waitFor((message: IRCMessage): boolean => {
      // The server echoes our JOIN back once we are in.
      if (
        message.command === "JOIN" &&
        IRCMessageUtil.isSameName(
          IRCMessageUtil.getNickname(message.source),
          this.nickname,
        )
      ) {
        return true;
      }

      if (
        JOIN_FAILURE_REPLIES.has(message.command) ||
        IRCSession.isStandardFailure(message, "JOIN")
      ) {
        throw new IRCError(
          `Could not join ${channel}: ${IRCClient.describeReply(message)}.${
            message.command === "475" ? " Check Channel Key." : ""
          }`,
        );
      }

      return false;
    });

    this.log(`Joined ${channel}.`);
  }

  /*
   * ------------------------------------------------------------------- Send
   */

  private async sendLines(): Promise<number> {
    this.phase = Phase.Sending;

    const target: string = this.options.target;
    const pacing: IRCPacing = this.options.pacing || IRC_DEFAULT_PACING;

    this.replyCheck = (message: IRCMessage): Error | null => {
      if (
        !SEND_FAILURE_REPLIES.has(message.command) &&
        !IRCSession.isStandardFailure(message, "PRIVMSG")
      ) {
        return null;
      }

      const hint: string =
        !this.options.joinChannel && message.command === "404"
          ? " The channel may take messages from its members only: turn off Send Without Joining."
          : "";

      return new IRCError(
        `Could not send to ${target}: ${IRCClient.describeReply(message)}.${hint}`,
      );
    };

    for (let index: number = 0; index < this.options.lines.length; index++) {
      if (index >= pacing.burst) {
        await this.sleep(pacing.intervalInMs);
      }

      this.send({
        command: "PRIVMSG",
        middle: [target],
        trailing: this.options.lines[index] as string,
      });
    }

    this.phase = Phase.Confirming;

    /*
     * A server handles a client's lines in order, so once the PONG for this
     * PING is back, any refusal of the lines before it has arrived too.
     */
    const token: string = `oneuptime-${crypto.randomBytes(8).toString("hex")}`;

    this.send({ command: "PING", trailing: token });

    await this.waitFor((message: IRCMessage): boolean => {
      return (
        message.command === "PONG" &&
        message.params[message.params.length - 1] === token
      );
    });

    this.replyCheck = null;

    this.log(
      `Sent ${this.options.lines.length} ${
        this.options.lines.length === 1 ? "line" : "lines"
      } to ${target}.`,
    );

    return this.options.lines.length;
  }

  /*
   * ------------------------------------------------------------------- Quit
   */

  private async quit(): Promise<void> {
    this.phase = Phase.Quitting;

    /*
     * The message is delivered by now, so nothing here can fail the step:
     * the server gets a moment to close the connection itself, and then it
     * is closed regardless.
     */
    try {
      this.send({ command: "QUIT", trailing: QUIT_MESSAGE });

      const socket: net.Socket | null = this.socket;

      if (!socket || socket.destroyed) {
        return;
      }

      await this.track<void>((resolve: () => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(
          resolve,
          QUIT_GRACE_IN_MS,
        );
        this.timers.add(timer);

        socket.once("close", () => {
          resolve();
        });
      });
    } catch {
      // Already delivered; see above.
    }
  }

  /*
   * --------------------------------------------------------------- Plumbing
   */

  private send(data: {
    command: string;
    middle?: Array<string> | undefined;
    trailing?: string | undefined;
  }): void {
    if (this.failure) {
      throw this.failure;
    }

    const line: string = IRCMessageUtil.build(data);

    this.socket?.write(`${line}\r\n`, "utf8");
  }

  private onData(chunk: Buffer): void {
    if (this.failure || this.isFinished) {
      return;
    }

    this.incomingBytes += chunk.length;

    if (this.incomingBytes > MAX_INCOMING_BYTES) {
      this.fail(
        new IRCError(
          `The IRC server ${this.serverName} sent more than OneUptime reads from one connection.`,
        ),
      );
      return;
    }

    this.incoming = Buffer.concat([this.incoming, chunk]);

    let lineEnd: number = this.incoming.indexOf(0x0a);

    while (lineEnd !== -1) {
      let line: Buffer = this.incoming.subarray(0, lineEnd);
      this.incoming = this.incoming.subarray(lineEnd + 1);

      if (line.length > 0 && line[line.length - 1] === 0x0d) {
        line = line.subarray(0, line.length - 1);
      }

      if (line.length > MAX_INCOMING_LINE_BYTES) {
        this.fail(this.getNotIrcError());
        return;
      }

      this.onLine(line.toString("utf8"));

      if (this.failure || this.isFinished) {
        return;
      }

      lineEnd = this.incoming.indexOf(0x0a);
    }

    if (this.incoming.length > MAX_INCOMING_LINE_BYTES) {
      this.fail(this.getNotIrcError());
    }
  }

  private onLine(line: string): void {
    // An empty line is allowed, and means nothing.
    if (line.length === 0) {
      return;
    }

    const message: IRCMessage | null = IRCMessageUtil.parse(line);

    if (!message) {
      this.fail(this.getNotIrcError());
      return;
    }

    this.hasHeardIRC = true;

    try {
      if (message.command === "PING") {
        // Some servers make a client answer one before they register it.
        this.send({
          command: "PONG",
          trailing: message.params[message.params.length - 1] || "",
        });
        return;
      }

      if (message.command === "ERROR") {
        if (this.phase === Phase.Quitting) {
          return;
        }

        this.fail(
          new IRCError(
            `The IRC server closed the connection: ${IRCClient.describeReply(message)}.`,
          ),
        );
        return;
      }

      // The server renamed us, or confirmed a rename.
      if (
        message.command === "NICK" &&
        IRCMessageUtil.isSameName(
          IRCMessageUtil.getNickname(message.source),
          this.nickname,
        ) &&
        message.params[0]
      ) {
        this.nickname = message.params[0];
      }

      const refusal: Error | null = this.replyCheck
        ? this.replyCheck(message)
        : null;

      if (refusal) {
        this.fail(refusal);
        return;
      }
    } catch (error) {
      // A PING token that cannot be echoed back on one line.
      this.fail(error instanceof IRCError ? error : this.getNotIrcError());
      return;
    }

    this.received.push(message);
    this.deliver();
  }

  private onConnectionLost(error: Error | null): void {
    if (this.isFinished || this.failure || this.phase === Phase.Quitting) {
      return;
    }

    /*
     * A TLS port hangs up on a client that does not start TLS: it closes the
     * connection, or resets it if the client's lines are still unread.
     */
    const tlsHint: string =
      !this.hasHeardIRC && !this.options.useTls
        ? " If the port takes TLS connections (6697 usually does), turn off Disable TLS."
        : "";

    if (error) {
      this.fail(
        new IRCError(
          `Lost the connection to the IRC server ${this.serverName}: ${error.message}.${tlsHint}`,
        ),
      );
      return;
    }

    if (!this.hasHeardIRC) {
      this.fail(
        new IRCError(
          `The IRC server ${this.serverName} closed the connection without a word.${tlsHint}`,
        ),
      );
      return;
    }

    this.fail(
      new IRCError(
        `The IRC server ${this.serverName} closed the connection while ${this.describePhase()}.`,
      ),
    );
  }

  /*
   * Resolves once `handle` returns true for a message from the server, in
   * the order they arrived. A message no waiter took is kept for the next.
   * `handle` throws to fail the session.
   */
  private async waitFor(
    handle: (message: IRCMessage) => boolean,
  ): Promise<void> {
    await this.track<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        this.waiter = { handle, resolve, reject };
        this.deliver();
      },
    );
  }

  private deliver(): void {
    while (this.waiter && this.received.length > 0) {
      const waiter: MessageWaiter = this.waiter;
      const message: IRCMessage = this.received.shift() as IRCMessage;

      let isDone: boolean = false;

      try {
        isDone = waiter.handle(message);
      } catch (error) {
        this.waiter = null;
        this.fail(error as Error);
        return;
      }

      if (isDone) {
        this.waiter = null;
        waiter.resolve();
        return;
      }
    }
  }

  private async sleep(milliseconds: number): Promise<void> {
    await this.track<void>((resolve: () => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, milliseconds);

      this.timers.add(timer);
    });
  }

  /*
   * A promise that fail() rejects too, so whatever the session is waiting
   * for - the connection, a reply, the pause between lines - ends the moment
   * the session fails, instead of when it would have finished.
   */
  private async track<T>(
    start: (
      resolve: (value: T) => void,
      reject: (error: Error) => void,
    ) => void,
  ): Promise<T> {
    if (this.failure) {
      throw this.failure;
    }

    return await new Promise<T>(
      (resolve: (value: T) => void, reject: (error: Error) => void) => {
        let isSettled: boolean = false;

        const operation: PendingOperation = {
          reject: (error: Error) => {
            if (!isSettled) {
              isSettled = true;
              this.pending.delete(operation);
              reject(error);
            }
          },
        };

        this.pending.add(operation);

        try {
          start((value: T) => {
            if (!isSettled) {
              isSettled = true;
              this.pending.delete(operation);
              resolve(value);
            }
          }, operation.reject);
        } catch (error) {
          operation.reject(error as Error);
        }
      },
    );
  }

  private fail(error: Error): void {
    if (this.failure || this.isFinished) {
      return;
    }

    this.failure = error;

    const waiter: MessageWaiter | null = this.waiter;
    this.waiter = null;
    waiter?.reject(error);

    for (const operation of Array.from(this.pending)) {
      operation.reject(error);
    }

    this.cleanUp();
  }

  private cleanUp(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }

    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    this.timers.clear();

    for (const socket of [this.socket, this.rawSocket]) {
      if (socket && !socket.destroyed) {
        socket.on("error", () => {});
        socket.destroy();
      }
    }
  }

  private getTimeoutError(): IRCError {
    const seconds: number = Math.max(
      1,
      Math.round(this.options.timeoutInMs / 1000),
    );
    const duration: string = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;

    if (this.phase === Phase.Confirming) {
      return new IRCError(
        `The IRC server ${this.serverName} did not confirm the message within ${duration}. It may have been delivered.`,
      );
    }

    return new IRCError(
      `Timed out after ${duration} while ${this.describePhase()}.`,
    );
  }

  private getNotIrcError(): IRCError {
    return new IRCError(
      `The server at ${this.serverName} did not answer like an IRC server. Check IRC Server, Port and Disable TLS.`,
    );
  }

  private describePhase(): string {
    switch (this.phase) {
      case Phase.Connecting:
        return `connecting to the IRC server ${this.serverName}`;
      case Phase.Registering:
        return `registering with the IRC server ${this.serverName}`;
      case Phase.Joining:
        return `joining ${this.options.target}`;
      case Phase.Sending:
        return `sending to ${this.options.target}`;
      case Phase.Confirming:
        return `waiting for the IRC server to confirm the message`;
      case Phase.Quitting:
        return "disconnecting";
    }
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  // IRCv3 standard replies: "FAIL PRIVMSG <code> :<description>".
  private static isStandardFailure(
    message: IRCMessage,
    command: string,
  ): boolean {
    return (
      message.command === "FAIL" &&
      (message.params[0] || "").toUpperCase() === command
    );
  }
}
