import net from "net";
import tls from "tls";

/*
 * Just enough of an IRC server to walk the IRC client through every part of
 * a conversation, on a port of its own on 127.0.0.1, over TLS or not.
 *
 * By default it behaves like a well-run network: it registers a client once
 * it has NICK and USER (and CAP END, once CAP has been used), echoes a JOIN,
 * takes every PRIVMSG in silence, answers PING, and closes the connection on
 * QUIT. Each option makes it behave like a server that does something else -
 * holds a nickname, wants a password, speaks SASL, bans the client - and
 * `onMessage` lets a test answer any line its own way.
 *
 * It parses what the client sends with its own few lines of code, not with
 * the parser under test, so the two cannot agree on a mistake.
 */

export interface FakeIRCLine {
  line: string;
  receivedAt: number;
}

export interface FakeIRCMessage {
  command: string;
  params: Array<string>;
}

export interface FakeIRCConnection {
  send: (line: string) => void;
  close: () => void;
  // The nickname the client registered or is registering as.
  nickname: string;
  // What TLS was asked for by name (SNI), on a TLS connection.
  servername: string | false | null | undefined;
}

export interface FakeIRCSaslAccount {
  username: string;
  password: string;
  // The value of the "sasl" capability: "PLAIN,EXTERNAL", or null for none.
  mechanisms?: string | null | undefined;
}

export interface FakeIRCServerOptions {
  tls?: { key: string; cert: string } | undefined;
  // Lines sent the moment a client connects.
  greeting?: Array<string> | undefined;
  takenNicknames?: Array<string> | undefined;
  erroneousNicknames?: Array<string> | undefined;
  // Registration needs PASS with this value.
  password?: string | undefined;
  sasl?: FakeIRCSaslAccount | undefined;
  // CAP LS is answered over several lines, like a server with many.
  splitCapabilities?: boolean | undefined;
  // "421 Unknown command" for CAP, like a server from before IRCv3.
  rejectCap?: boolean | undefined;
  // Registers the client at NICK and USER, as if it had never heard CAP.
  ignoreCap?: boolean | undefined;
  // A PING the client must answer before it is registered.
  pingCookie?: boolean | undefined;
  // The key the channel has (+k).
  channelKey?: string | undefined;
  // The reply to JOIN, instead of letting the client in.
  joinReply?: string | undefined;
  // Echoes the JOIN with the nickname in other letters.
  joinEchoNickname?: string | undefined;
  // The reply to the first PRIVMSG, instead of silence.
  privmsgReply?: string | undefined;
  /*
   * How long after the PRIVMSG that reply comes. With PING answered at
   * once, this is a bouncer: it answers the PING itself, and the network's
   * refusal comes later.
   */
  privmsgReplyDelayInMs?: number | undefined;
  // A channel the server puts every client in once it is registered.
  autoJoin?: string | undefined;
  // Nicknames are cut to this length, as Solanum does with NICKLEN.
  truncateNicknamesTo?: number | undefined;
  // Nicknames longer than this are refused (432), as InspIRCd does.
  refuseNicknamesLongerThan?: number | undefined;
  /*
   * The nickname the client is given whatever it asks for, as a bouncer or
   * a network that ties nicknames to accounts does.
   */
  forcedNickname?: string | undefined;
  // Whether PING is answered. On by default.
  answerPing?: boolean | undefined;
  // Answer a line any way at all. Returning true skips the default.
  onMessage?:
    | ((
        message: FakeIRCMessage,
        connection: FakeIRCConnection,
      ) => boolean | void)
    | undefined;
  // Raw bytes to write the moment a client connects, instead of IRC.
  onConnect?: ((socket: net.Socket) => void) | undefined;
}

export interface FakeIRCServer {
  port: number;
  // Every line the client sent, without its CRLF.
  lines: Array<FakeIRCLine>;
  // The SNI of each TLS connection.
  servernames: Array<string | false | null | undefined>;
  connectionCount: () => number;
  close: () => Promise<void>;
}

export const SERVER_NAME: string = "irc.fake.test";

export const parseClientLine: (line: string) => FakeIRCMessage = (
  line: string,
): FakeIRCMessage => {
  const trailingAt: number = line.indexOf(" :");
  const head: string = trailingAt === -1 ? line : line.substring(0, trailingAt);
  const words: Array<string> = head.split(" ").filter((word: string) => {
    return word.length > 0;
  });
  const params: Array<string> = words.slice(1);

  if (trailingAt !== -1) {
    params.push(line.substring(trailingAt + 2));
  }

  return { command: (words[0] || "").toUpperCase(), params: params };
};

export const startFakeIRCServer: (
  options?: FakeIRCServerOptions,
) => Promise<FakeIRCServer> = async (
  options: FakeIRCServerOptions = {},
): Promise<FakeIRCServer> => {
  const lines: Array<FakeIRCLine> = [];
  const servernames: Array<string | false | null | undefined> = [];
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  let connectionCount: number = 0;

  const onSocket: (socket: net.Socket) => void = (socket: net.Socket): void => {
    connectionCount++;
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});

    const servername: string | false | null | undefined =
      socket instanceof tls.TLSSocket ? socket.servername : undefined;

    if (socket instanceof tls.TLSSocket) {
      servernames.push(servername);
    }

    if (options.onConnect) {
      options.onConnect(socket);
      return;
    }

    let buffered: string = "";
    let nickname: string = "";
    let hasUser: boolean = false;
    let isCapNegotiating: boolean = false;
    let isRegistered: boolean = false;
    let passwordGiven: string | undefined = undefined;
    let cookie: string | null = options.pingCookie ? "cookie-1234" : null;
    let isCookieSent: boolean = false;
    let isPrivmsgAnswered: boolean = false;
    let saslPayload: string = "";

    const connection: FakeIRCConnection = {
      send: (line: string): void => {
        if (!socket.destroyed) {
          socket.write(`${line}\r\n`);
        }
      },
      close: (): void => {
        socket.end();
      },
      nickname: "",
      servername: servername,
    };

    const send: (line: string) => void = connection.send;
    const target: () => string = (): string => {
      return nickname || "*";
    };

    for (const line of options.greeting || []) {
      send(line);
    }

    const tryRegister: () => void = (): void => {
      if (isRegistered || !nickname || !hasUser || isCapNegotiating) {
        return;
      }

      if (cookie) {
        if (!isCookieSent) {
          isCookieSent = true;
          send(`PING :${cookie}`);
        }

        return;
      }

      if (
        options.password !== undefined &&
        passwordGiven !== options.password
      ) {
        send(`:${SERVER_NAME} 464 ${target()} :Password incorrect`);
        send("ERROR :Closing Link: (Bad Password)");
        socket.end();
        return;
      }

      isRegistered = true;

      if (options.forcedNickname) {
        nickname = options.forcedNickname;
        connection.nickname = nickname;
      }

      send(
        `:${SERVER_NAME} 001 ${nickname} :Welcome to the Fake IRC Network ${nickname}`,
      );
      send(`:${SERVER_NAME} 002 ${nickname} :Your host is ${SERVER_NAME}`);
      send(
        `:${SERVER_NAME} 005 ${nickname} CHANTYPES=# NICKLEN=30 :are supported by this server`,
      );
      send(
        `:${SERVER_NAME} 375 ${nickname} :- ${SERVER_NAME} Message of the day -`,
      );
      send(`:${SERVER_NAME} 372 ${nickname} :- Be nice.`);
      send(`:${SERVER_NAME} 376 ${nickname} :End of /MOTD command.`);

      if (options.autoJoin) {
        send(
          `:${nickname}!~oneuptime@client.fake.test JOIN ${options.autoJoin}`,
        );
        send(
          `:${SERVER_NAME} 366 ${nickname} ${options.autoJoin} :End of /NAMES list.`,
        );
      }
    };

    const handle: (message: FakeIRCMessage) => void = (
      message: FakeIRCMessage,
    ): void => {
      if (options.onMessage && options.onMessage(message, connection)) {
        return;
      }

      switch (message.command) {
        case "CAP": {
          const subcommand: string = (message.params[0] || "").toUpperCase();

          if (options.rejectCap) {
            send(`:${SERVER_NAME} 421 ${target()} CAP :Unknown command`);
            return;
          }

          if (options.ignoreCap) {
            return;
          }

          if (subcommand === "LS") {
            isCapNegotiating = true;

            const sasl: string = !options.sasl
              ? ""
              : options.sasl.mechanisms === null
                ? "sasl"
                : `sasl=${options.sasl.mechanisms ?? "PLAIN,EXTERNAL"}`;

            if (options.splitCapabilities) {
              send(`:${SERVER_NAME} CAP * LS * :multi-prefix away-notify`);
              send(`:${SERVER_NAME} CAP * LS * :account-notify extended-join`);
              send(`:${SERVER_NAME} CAP * LS :server-time ${sasl}`.trimEnd());
            } else {
              send(
                `:${SERVER_NAME} CAP * LS :multi-prefix ${sasl} server-time`,
              );
            }
          } else if (subcommand === "REQ") {
            const requested: string = message.params[1] || "";

            if (options.sasl && requested === "sasl") {
              send(`:${SERVER_NAME} CAP ${target()} ACK :sasl`);
            } else {
              send(`:${SERVER_NAME} CAP ${target()} NAK :${requested}`);
            }
          } else if (subcommand === "END") {
            isCapNegotiating = false;
            tryRegister();
          }

          return;
        }

        case "AUTHENTICATE": {
          const value: string = message.params[0] || "";

          if (value === "PLAIN") {
            send("AUTHENTICATE +");
            return;
          }

          // The credentials come in pieces of 400; a shorter one, or "+", ends them.
          if (value !== "+") {
            saslPayload += value;
          }

          if (value.length === 400) {
            return;
          }

          const decoded: string = Buffer.from(saslPayload, "base64").toString(
            "utf8",
          );
          saslPayload = "";
          const expected: string = options.sasl
            ? `${options.sasl.username}\0${options.sasl.username}\0${options.sasl.password}`
            : "";

          if (options.sasl && decoded === expected) {
            send(
              `:${SERVER_NAME} 900 ${target()} ${target()}!u@h ${options.sasl.username} :You are now logged in as ${options.sasl.username}`,
            );
            send(
              `:${SERVER_NAME} 903 ${target()} :SASL authentication successful`,
            );
          } else {
            send(`:${SERVER_NAME} 904 ${target()} :SASL authentication failed`);
          }

          return;
        }

        case "PASS": {
          passwordGiven = message.params[0];
          return;
        }

        case "NICK": {
          let wanted: string = message.params[0] || "";

          if (
            options.refuseNicknamesLongerThan !== undefined &&
            wanted.length > options.refuseNicknamesLongerThan
          ) {
            send(
              `:${SERVER_NAME} 432 ${target()} ${wanted} :Erroneous Nickname`,
            );
            return;
          }

          if (options.truncateNicknamesTo !== undefined) {
            wanted = wanted.substring(0, options.truncateNicknamesTo);
          }

          if ((options.erroneousNicknames || []).includes(wanted)) {
            send(
              `:${SERVER_NAME} 432 ${target()} ${wanted} :Erroneous Nickname`,
            );
            return;
          }

          if ((options.takenNicknames || []).includes(wanted)) {
            send(
              `:${SERVER_NAME} 433 ${target()} ${wanted} :Nickname is already in use.`,
            );
            return;
          }

          nickname = wanted;
          connection.nickname = wanted;
          tryRegister();
          return;
        }

        case "USER": {
          hasUser = true;
          tryRegister();
          return;
        }

        case "PONG": {
          if (cookie && message.params[message.params.length - 1] === cookie) {
            cookie = null;
            tryRegister();
          }

          return;
        }

        case "PING": {
          if (options.answerPing !== false) {
            send(
              `:${SERVER_NAME} PONG ${SERVER_NAME} :${message.params[message.params.length - 1] || ""}`,
            );
          }

          return;
        }

        case "JOIN": {
          const channel: string = message.params[0] || "";

          if (options.joinReply) {
            send(options.joinReply.replace("{nick}", nickname));
            return;
          }

          if (
            options.channelKey !== undefined &&
            message.params[1] !== options.channelKey
          ) {
            send(
              `:${SERVER_NAME} 475 ${nickname} ${channel} :Cannot join channel (+k) - bad key`,
            );
            return;
          }

          send(
            `:${options.joinEchoNickname || nickname}!~oneuptime@client.fake.test JOIN ${channel}`,
          );
          send(
            `:${SERVER_NAME} 332 ${nickname} ${channel} :Where the work happens`,
          );
          send(
            `:${SERVER_NAME} 353 ${nickname} = ${channel} :${nickname} @alice bob`,
          );
          send(
            `:${SERVER_NAME} 366 ${nickname} ${channel} :End of /NAMES list.`,
          );
          return;
        }

        case "PRIVMSG": {
          if (options.privmsgReply && !isPrivmsgAnswered) {
            isPrivmsgAnswered = true;

            const reply: string = options.privmsgReply.replace(
              "{nick}",
              nickname,
            );

            if (options.privmsgReplyDelayInMs) {
              setTimeout(() => {
                send(reply);
              }, options.privmsgReplyDelayInMs);
            } else {
              send(reply);
            }
          }

          return;
        }

        case "QUIT": {
          send(
            `ERROR :Closing Link: client.fake.test (Quit: ${message.params[0] || ""})`,
          );
          socket.end();
          return;
        }

        default:
          return;
      }
    };

    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");

      let lineEnd: number = buffered.indexOf("\r\n");

      while (lineEnd !== -1) {
        const line: string = buffered.substring(0, lineEnd);
        buffered = buffered.substring(lineEnd + 2);
        lines.push({ line: line, receivedAt: Date.now() });
        handle(parseClientLine(line));
        lineEnd = buffered.indexOf("\r\n");
      }
    });
  };

  const server: net.Server = options.tls
    ? tls.createServer(
        { key: options.tls.key, cert: options.tls.cert },
        onSocket,
      )
    : net.createServer(onSocket);

  // A client that does not speak TLS to a TLS server is not a test failure.
  server.on("tlsClientError", () => {});

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    lines: lines,
    servernames: servernames,
    connectionCount: (): number => {
      return connectionCount;
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

// The lines a client sent, without the ones that differ on every run.
export const linesSent: (server: FakeIRCServer) => Array<string> = (
  server: FakeIRCServer,
): Array<string> => {
  return server.lines.map((entry: FakeIRCLine) => {
    return entry.line.replace(
      /^PING :oneuptime-[0-9a-f]{16}$/,
      "PING :<token>",
    );
  });
};
