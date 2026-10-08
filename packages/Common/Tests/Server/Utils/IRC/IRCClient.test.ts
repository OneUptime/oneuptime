import IRCClient, {
  IRC_DEFAULT_PACING,
  IRC_DEFAULT_REFUSAL_GRACE_IN_MS,
  IRCError,
  IRCSendOptions,
  IRCSendResult,
} from "../../../../Server/Utils/IRC/IRCClient";
import {
  FakeIRCConnection,
  FakeIRCLine,
  FakeIRCMessage,
  FakeIRCServer,
  FakeIRCServerOptions,
  SERVER_NAME,
  linesSent,
  startFakeIRCServer,
} from "./FakeIRCServer";
import { TestCertificate, createTestCertificate } from "./TestCertificate";
import IRCValidation from "../../../../Server/Utils/IRC/IRCValidation";
import dns from "dns";
import net from "net";
import tls from "tls";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The IRC client against a server that speaks IRC: a real socket, and real
 * TLS with a certificate made for the test. Each test sets the server up to
 * behave the way some network does - holding a nickname, wanting SASL,
 * banning the client - and checks both what the client sent and what it
 * made of the answer.
 *
 * The server's name is under .invalid (RFC 6761), which never resolves: the
 * client is handed 127.0.0.1 as the address the egress guard approved, and
 * has to use that instead of looking the name up.
 */

const HOST_NAME: string = "irc.test.invalid";

const LOOPBACK: Array<{ address: string; family: number }> = [
  { address: "127.0.0.1", family: 4 },
];

const NICKNAMES: Array<string> = [
  "OneUptime",
  "OneUptime_",
  "OneUptime__",
  "OneUptime123",
];

let server: FakeIRCServer | undefined;

async function start(
  options: FakeIRCServerOptions = {},
): Promise<FakeIRCServer> {
  server = await startFakeIRCServer(options);
  return server;
}

function options(
  fakeServer: FakeIRCServer,
  overrides: Partial<IRCSendOptions> = {},
): IRCSendOptions {
  return {
    host: HOST_NAME,
    port: fakeServer.port,
    addresses: LOOPBACK,
    useTls: false,
    nicknames: NICKNAMES,
    target: "#ops",
    joinChannel: true,
    text: "Deploy finished",
    maxLines: 15,
    timeoutInMs: 5000,
    pacing: { burst: 20, intervalInMs: 10 },
    // The tests that are about it set it; the rest need not wait a second.
    refusalGraceInMs: 0,
    ...overrides,
  };
}

async function sendAndGetError(sendOptions: IRCSendOptions): Promise<Error> {
  try {
    await IRCClient.sendMessage(sendOptions);
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the message not to be sent");
}

// Trust a test certificate, the way NODE_EXTRA_CA_CERTS would in production.
function trust(certificate: TestCertificate): void {
  const realConnect: typeof tls.connect = tls.connect;

  jest.spyOn(tls, "connect").mockImplementation(((
    connectOptions: tls.ConnectionOptions,
  ) => {
    return realConnect({ ...connectOptions, ca: [certificate.cert] });
  }) as never);
}

afterEach(async () => {
  jest.restoreAllMocks();

  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("IRCClient — a message delivered", () => {
  test("registers, joins, sends, confirms with a PING and quits", async () => {
    const fakeServer: FakeIRCServer = await start();
    const log: Array<string> = [];

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        text: "Incident #42 declared\nSeverity: Critical",
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(linesSent(fakeServer)).toEqual([
      "NICK OneUptime",
      "USER oneuptime 0 * :OneUptime",
      "JOIN #ops",
      "PRIVMSG #ops :Incident #42 declared",
      "PRIVMSG #ops :Severity: Critical",
      "PING :<token>",
      "QUIT :Sent from OneUptime",
    ]);
    expect(result).toEqual({ nickname: "OneUptime", linesSent: 2 });
    expect(log).toEqual([
      `Connecting to the IRC server ${HOST_NAME}:${fakeServer.port} without TLS.`,
      'Registered with the IRC server as "OneUptime".',
      "Joined #ops.",
      "Sent 2 lines to #ops.",
    ]);
  });

  test("the PING it checks with carries a token of its own each time", async () => {
    const fakeServer: FakeIRCServer = await start();

    await IRCClient.sendMessage(options(fakeServer));
    await IRCClient.sendMessage(options(fakeServer));

    const pings: Array<string> = fakeServer.lines
      .map((entry: FakeIRCLine) => {
        return entry.line;
      })
      .filter((line: string) => {
        return line.startsWith("PING ");
      });

    expect(pings).toHaveLength(2);
    expect(pings[0]).toMatch(/^PING :oneuptime-[0-9a-f]{16}$/);
    expect(pings[0]).not.toBe(pings[1]);
  });

  test("a message to a person is sent without joining anything", async () => {
    const fakeServer: FakeIRCServer = await start();

    await IRCClient.sendMessage(
      options(fakeServer, { target: "alice", joinChannel: false }),
    );

    expect(linesSent(fakeServer)).toEqual([
      "NICK OneUptime",
      "USER oneuptime 0 * :OneUptime",
      "PRIVMSG alice :Deploy finished",
      "PING :<token>",
      "QUIT :Sent from OneUptime",
    ]);
  });

  test("Send Without Joining posts to the channel without a JOIN", async () => {
    const fakeServer: FakeIRCServer = await start();

    await IRCClient.sendMessage(options(fakeServer, { joinChannel: false }));

    expect(linesSent(fakeServer)).not.toContain("JOIN #ops");
    expect(linesSent(fakeServer)).toContain("PRIVMSG #ops :Deploy finished");
  });

  test("answers a PING the server sends before it lets the client in", async () => {
    const fakeServer: FakeIRCServer = await start({ pingCookie: true });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(linesSent(fakeServer)).toContain("PONG :cookie-1234");
    expect(result.linesSent).toBe(1);
  });

  test("answers a PING that arrives while it is sending", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "PRIVMSG") {
          connection.send(`PING :${SERVER_NAME}-keepalive`);
        }
      },
    });

    await IRCClient.sendMessage(
      options(fakeServer, {
        text: "one\ntwo",
        pacing: { burst: 1, intervalInMs: 100 },
      }),
    );

    expect(linesSent(fakeServer)).toContain(`PONG :${SERVER_NAME}-keepalive`);
  });

  test("takes no notice of the server's other chatter", async () => {
    const fakeServer: FakeIRCServer = await start({
      greeting: [
        `:${SERVER_NAME} NOTICE * :*** Looking up your hostname...`,
        `:${SERVER_NAME} NOTICE * :*** Could not resolve your hostname`,
        "",
      ],
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "JOIN") {
          connection.send(
            `@time=2026-10-08T10:00:00.000Z :alice!a@example.com PRIVMSG #ops :hello everyone`,
          );
        }
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.linesSent).toBe(1);
  });
});

describe("IRCClient — the message, in lines", () => {
  test("is sized for the nickname the server gives, not the one asked for", async () => {
    // A bouncer, or a network that ties nicknames to accounts.
    const forced: string = "a-much-longer-bouncer-nickname";
    const fakeServer: FakeIRCServer = await start({ forcedNickname: forced });
    const text: string = Array.from(
      { length: 300 },
      (_: unknown, index: number) => {
        return `word${index}`;
      },
    ).join(" ");

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { text: text }),
    );

    expect(result.nickname).toBe(forced);

    const privmsgs: Array<string> = linesSent(fakeServer).filter(
      (line: string) => {
        return line.startsWith("PRIVMSG");
      },
    );

    expect(privmsgs.length).toBeGreaterThan(3);

    for (const line of privmsgs) {
      // What the server passes on, with the longest user and host it allows.
      const relayed: string = `:${forced}!${"u".repeat(10)}@${"h".repeat(63)} ${line}\r\n`;

      expect(Buffer.byteLength(relayed, "utf8")).toBeLessThanOrEqual(512);
    }
  });

  test("a message too long is cut short, and the run log says so", async () => {
    const fakeServer: FakeIRCServer = await start();
    const log: Array<string> = [];

    await IRCClient.sendMessage(
      options(fakeServer, {
        text: Array.from({ length: 40 }, (_: unknown, index: number) => {
          return `line ${index + 1}`;
        }).join("\n"),
        maxLines: 5,
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(
      linesSent(fakeServer).filter((line: string) => {
        return line.startsWith("PRIVMSG");
      }),
    ).toEqual([
      "PRIVMSG #ops :line 1",
      "PRIVMSG #ops :line 2",
      "PRIVMSG #ops :line 3",
      "PRIVMSG #ops :line 4",
      "PRIVMSG #ops :… (message cut short: it is longer than 5 IRC lines)",
    ]);
    expect(log).toContain(
      "Message Text is longer than 5 IRC lines. The first 4 are sent, and a last line says the message was cut short.",
    );
  });

  test("a message with nothing to send sends nothing", async () => {
    const fakeServer: FakeIRCServer = await start();

    const error: Error = await sendAndGetError(
      options(fakeServer, { text: " \n\t\u0001\n" }),
    );

    expect(error.message).toBe(
      "Message Text has nothing to send: it is blank, or holds only characters IRC cannot carry.",
    );
    expect(
      linesSent(fakeServer).some((line: string) => {
        return line.startsWith("PRIVMSG");
      }),
    ).toBe(false);
  });
});

describe("IRCClient — the nickname", () => {
  test("tries the next nickname while the server says one is taken", async () => {
    const fakeServer: FakeIRCServer = await start({
      takenNicknames: ["OneUptime", "OneUptime_"],
    });
    const log: Array<string> = [];

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(linesSent(fakeServer).slice(0, 4)).toEqual([
      "NICK OneUptime",
      "USER oneuptime 0 * :OneUptime",
      "NICK OneUptime_",
      "NICK OneUptime__",
    ]);
    expect(result.nickname).toBe("OneUptime__");
    expect(log).toContain(
      'The nickname "OneUptime_" is taken. Trying "OneUptime__".',
    );
    expect(log).toContain('Registered with the IRC server as "OneUptime__".');
  });

  test("gives up, naming every nickname tried, when all are taken", async () => {
    const fakeServer: FakeIRCServer = await start({
      takenNicknames: NICKNAMES,
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error).toBeInstanceOf(IRCError);
    expect(error.message).toBe(
      "Every nickname tried is taken or refused on this IRC server: OneUptime, OneUptime_, OneUptime__, OneUptime123. Set another Nickname.",
    );
  });

  test("a server that refuses a longer nickname gets one as long as the one asked for", async () => {
    // InspIRCd refuses a nickname past its limit with 432.
    const fakeServer: FakeIRCServer = await start({
      takenNicknames: ["OneUptime"],
      refuseNicknamesLongerThan: 9,
    });
    const log: Array<string> = [];

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        nicknames: IRCClient.getNicknameCandidates("OneUptime"),
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(result.nickname).toBe("OneUptim_");
    expect(log).toContain(
      'The IRC server refused the nickname "OneUptime_": Erroneous Nickname. Trying "OneUptime__".',
    );
  });

  test("a server that cuts a longer nickname short gets one as long as the one asked for", async () => {
    // Solanum cuts a nickname to its NICKLEN - back to the one that is taken.
    const fakeServer: FakeIRCServer = await start({
      takenNicknames: ["OneUptime"],
      truncateNicknamesTo: 9,
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        nicknames: IRCClient.getNicknameCandidates("OneUptime"),
      }),
    );

    expect(result.nickname).toBe("OneUptim_");
  });

  test("stops at a nickname the server will not have", async () => {
    const fakeServer: FakeIRCServer = await start({
      erroneousNicknames: ["OneUptime"],
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      'The IRC server refused the nickname "OneUptime": Erroneous Nickname. Set another Nickname.',
    );
    expect(linesSent(fakeServer)).not.toContain("NICK OneUptime_");
  });

  test("the nickname the server welcomes it as is the one it uses", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        // A network that truncates a long nickname to its NICKLEN.
        if (message.command === "USER") {
          connection.send(`:${SERVER_NAME} 001 OneUpt :Welcome OneUpt`);
          return true;
        }

        if (message.command === "JOIN") {
          connection.send(`:OneUpt!~o@client.fake.test JOIN #ops`);
          return true;
        }

        return false;
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.nickname).toBe("OneUpt");
  });

  test("follows a rename by the server", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "JOIN") {
          connection.send(":OneUptime!~o@client.fake.test NICK :Guest4711");
          connection.send(":Guest4711!~o@client.fake.test JOIN #ops");
          return true;
        }

        return false;
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.nickname).toBe("Guest4711");
  });

  test("knows its JOIN in other letters, as IRC compares names", async () => {
    const fakeServer: FakeIRCServer = await start({
      joinEchoNickname: "oneuptime",
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.linesSent).toBe(1);
  });
});

describe("IRCClient — passwords", () => {
  test("sends the server password first, as a plain parameter", async () => {
    const fakeServer: FakeIRCServer = await start({ password: "s3cret" });

    await IRCClient.sendMessage(
      options(fakeServer, { serverPassword: "s3cret" }),
    );

    expect(linesSent(fakeServer).slice(0, 2)).toEqual([
      "PASS s3cret",
      "NICK OneUptime",
    ]);
  });

  test("sends a password with a space in it as the last parameter", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage) => {
        return message.command === "PASS";
      },
    });

    await IRCClient.sendMessage(
      options(fakeServer, { serverPassword: "correct horse" }),
    );

    expect(linesSent(fakeServer)[0]).toBe("PASS :correct horse");
  });

  test("a refused server password fails without quoting it", async () => {
    const fakeServer: FakeIRCServer = await start({ password: "right" });

    const error: Error = await sendAndGetError(
      options(fakeServer, { serverPassword: "wrong-password" }),
    );

    expect(error.message).toBe(
      "The IRC server refused the connection: Password incorrect. Check Server Password.",
    );
    expect(error.message).not.toContain("wrong-password");
  });

  test("says a password is needed when the server asks for one", async () => {
    const fakeServer: FakeIRCServer = await start({ password: "right" });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "The IRC server refused the connection: Password incorrect. It needs a password: fill in Server Password.",
    );
  });
});

describe("IRCClient — SASL", () => {
  const SASL: { username: string; password: string } = {
    username: "oneuptime-bot",
    password: "correct horse battery staple",
  };

  test("signs in before the server lets it in", async () => {
    const fakeServer: FakeIRCServer = await start({ sasl: { ...SASL } });
    const log: Array<string> = [];

    await IRCClient.sendMessage(
      options(fakeServer, {
        sasl: SASL,
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    const payload: string = Buffer.from(
      `oneuptime-bot\0oneuptime-bot\0correct horse battery staple`,
    ).toString("base64");

    expect(linesSent(fakeServer).slice(0, 7)).toEqual([
      "CAP LS 302",
      "NICK OneUptime",
      "USER oneuptime 0 * :OneUptime",
      "CAP REQ :sasl",
      "AUTHENTICATE PLAIN",
      `AUTHENTICATE ${payload}`,
      "CAP END",
    ]);
    expect(log).toContain('Signed in with SASL as "oneuptime-bot".');

    for (const line of log) {
      expect(line).not.toContain(SASL.password);
    }
  });

  test("reads a capability list sent over several lines", async () => {
    const fakeServer: FakeIRCServer = await start({
      sasl: { ...SASL },
      splitCapabilities: true,
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { sasl: SASL }),
    );

    expect(result.linesSent).toBe(1);
    expect(
      linesSent(fakeServer).filter((line: string) => {
        return line === "CAP REQ :sasl";
      }),
    ).toHaveLength(1);
  });

  test("takes a bare 'sasl' capability, which lists no mechanisms", async () => {
    const fakeServer: FakeIRCServer = await start({
      sasl: { ...SASL, mechanisms: null },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { sasl: SASL }),
    );

    expect(result.linesSent).toBe(1);
  });

  test("refused credentials fail without quoting the password", async () => {
    const fakeServer: FakeIRCServer = await start({
      sasl: { username: "oneuptime-bot", password: "the-real-one" },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { sasl: SASL }),
    );

    expect(error.message).toBe(
      "SASL sign-in failed: SASL authentication failed. Check SASL Username and SASL Password.",
    );
    expect(error.message).not.toContain(SASL.password);
    expect(linesSent(fakeServer)).not.toContain("CAP END");
  });

  test("a server that does not offer PLAIN says which sign-ins it does offer", async () => {
    const fakeServer: FakeIRCServer = await start({
      sasl: { ...SASL, mechanisms: "EXTERNAL,SCRAM-SHA-256" },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { sasl: SASL }),
    );

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} does not offer SASL PLAIN, which is the sign-in this step uses. It offers EXTERNAL, SCRAM-SHA-256.`,
    );
    expect(linesSent(fakeServer)).not.toContain("CAP REQ :sasl");
  });

  test("a server without SASL is refused rather than joined unsigned", async () => {
    const fakeServer: FakeIRCServer = await start();

    const error: Error = await sendAndGetError(
      options(fakeServer, { sasl: SASL }),
    );

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} does not offer SASL. Remove SASL Username and SASL Password, or use Server Password if the server takes one.`,
    );
    expect(linesSent(fakeServer)).not.toContain("JOIN #ops");
  });

  test.each([
    ["answers CAP with 421 Unknown command", { rejectCap: true }],
    ["registers the client without a word about CAP", { ignoreCap: true }],
  ])(
    "a server that %s does not support SASL",
    async (_label: string, serverOptions: FakeIRCServerOptions) => {
      const fakeServer: FakeIRCServer = await start(serverOptions);

      const error: Error = await sendAndGetError(
        options(fakeServer, { sasl: SASL }),
      );

      expect(error.message).toBe(
        `The IRC server ${HOST_NAME}:${fakeServer.port} does not support SASL. Remove SASL Username and SASL Password, or use Server Password if the server takes one.`,
      );
      expect(linesSent(fakeServer)).not.toContain("JOIN #ops");
    },
  );

  test("a server that refuses the SASL capability", async () => {
    const fakeServer: FakeIRCServer = await start({
      sasl: { ...SASL },
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "CAP" && message.params[0] === "REQ") {
          connection.send(`:${SERVER_NAME} CAP * NAK :sasl`);
          return true;
        }

        return false;
      },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { sasl: SASL }),
    );

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} refused to start SASL.`,
    );
  });

  test("long credentials go in 400-byte pieces, and an exact fit ends with +", async () => {
    // 2 x 100 + 398 + 2 NULs = 600 bytes, which is 800 characters of base64.
    const longSasl: { username: string; password: string } = {
      username: "u".repeat(100),
      password: "p".repeat(398),
    };
    const fakeServer: FakeIRCServer = await start({ sasl: { ...longSasl } });

    await IRCClient.sendMessage(options(fakeServer, { sasl: longSasl }));

    const pieces: Array<string> = linesSent(fakeServer)
      .filter((line: string) => {
        return (
          line.startsWith("AUTHENTICATE ") && line !== "AUTHENTICATE PLAIN"
        );
      })
      .map((line: string) => {
        return line.substring("AUTHENTICATE ".length);
      });

    expect(
      pieces.map((piece: string) => {
        return piece.length;
      }),
    ).toEqual([400, 400, 1]);
    expect(pieces[2]).toBe("+");
    expect(Buffer.from(pieces.slice(0, 2).join(""), "base64").toString()).toBe(
      `${longSasl.username}\0${longSasl.username}\0${longSasl.password}`,
    );
  });

  test("credentials that do not fill the last piece end without +", async () => {
    const fakeServer: FakeIRCServer = await start({ sasl: { ...SASL } });

    await IRCClient.sendMessage(options(fakeServer, { sasl: SASL }));

    expect(linesSent(fakeServer)).not.toContain("AUTHENTICATE +");
  });
});

describe("IRCClient — joining the channel", () => {
  test("gives the channel's key with the JOIN", async () => {
    const fakeServer: FakeIRCServer = await start({ channelKey: "hunter2" });

    await IRCClient.sendMessage(options(fakeServer, { channelKey: "hunter2" }));

    expect(linesSent(fakeServer)).toContain("JOIN #ops hunter2");
  });

  test("a wrong key says to check it, without quoting it", async () => {
    const fakeServer: FakeIRCServer = await start({ channelKey: "hunter2" });

    const error: Error = await sendAndGetError(
      options(fakeServer, { channelKey: "hunter3" }),
    );

    expect(error.message).toBe(
      "Could not join #ops: Cannot join channel (+k) - bad key. Check Channel Key.",
    );
    expect(error.message).not.toContain("hunter3");
  });

  test.each([
    ["474", "Cannot join channel (+b) - you are banned"],
    ["473", "Cannot join channel (+i) - you must be invited"],
    ["471", "Cannot join channel (+l) - channel is full, try again later"],
    [
      "477",
      "You need to be identified to a registered account to join this channel",
    ],
    ["403", "No such channel"],
    ["405", "You have joined too many channels"],
    ["470", "Forwarding to another channel"],
    ["489", "Cannot join channel (+S) - SSL/TLS required"],
    ["520", "Cannot join channel (+O) - IRC operators only"],
  ])(
    "reply %s to the JOIN fails with the server's reason",
    async (numeric: string, reason: string) => {
      const fakeServer: FakeIRCServer = await start({
        joinReply: `:${SERVER_NAME} ${numeric} {nick} #ops :${reason}`,
      });

      const error: Error = await sendAndGetError(options(fakeServer));

      expect(error.message).toBe(`Could not join #ops: ${reason}.`);
      expect(
        linesSent(fakeServer).some((line: string) => {
          return line.startsWith("PRIVMSG");
        }),
      ).toBe(false);
    },
  );

  test("a channel the server put it in is not the one it asked for", async () => {
    const fakeServer: FakeIRCServer = await start({
      autoJoin: "#welcome",
      joinReply: `:${SERVER_NAME} 474 {nick} #ops :Cannot join channel (+b) - you are banned`,
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "Could not join #ops: Cannot join channel (+b) - you are banned.",
    );
    expect(
      linesSent(fakeServer).some((line: string) => {
        return line.startsWith("PRIVMSG");
      }),
    ).toBe(false);
  });

  test("waits for its own channel past one the server put it in", async () => {
    const fakeServer: FakeIRCServer = await start({ autoJoin: "#welcome" });
    const log: Array<string> = [];

    await IRCClient.sendMessage(
      options(fakeServer, {
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(log).toContain("Joined #ops.");
    expect(linesSent(fakeServer)).toContain("PRIVMSG #ops :Deploy finished");
  });

  test("an error reply about the channel it has no name for is a refusal too", async () => {
    // Solanum's 480: the channel is throttling joins (+j).
    const fakeServer: FakeIRCServer = await start({
      joinReply: `:${SERVER_NAME} 480 {nick} #ops :Cannot join channel (+j) - throttle exceeded, try again later`,
    });
    const startedAt: number = Date.now();

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "Could not join #ops: Cannot join channel (+j) - throttle exceeded, try again later.",
    );
    // At once, not after the whole deadline.
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("an error reply about another channel is not about this one", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "JOIN") {
          connection.send(
            `:${SERVER_NAME} 480 ${connection.nickname} #elsewhere :Cannot join channel (+j)`,
          );
        }

        return false;
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.linesSent).toBe(1);
  });

  test("an IRCv3 FAIL for the JOIN fails it too", async () => {
    const fakeServer: FakeIRCServer = await start({
      joinReply: `:${SERVER_NAME} FAIL JOIN CHANNEL_RENAMED #ops :This channel has moved`,
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe("Could not join #ops: This channel has moved.");
  });
});

describe("IRCClient — the server refuses the message", () => {
  test("a refusal in reply to a PRIVMSG fails with the server's reason", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 404 {nick} #ops :Cannot send to nick/channel`,
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "Could not send to #ops: Cannot send to nick/channel.",
    );
  });

  test("when it did not join, says the channel may want members only", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 404 {nick} #ops :Cannot send to nick/channel`,
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { joinChannel: false }),
    );

    expect(error.message).toBe(
      "Could not send to #ops: Cannot send to nick/channel. The channel may take messages from its members only: turn off Send Without Joining.",
    );
  });

  test.each([
    ["401", "alice", "No such nick/channel"],
    ["486", "alice", "You must log in with services to message this user"],
    ["716", "alice", "is in +g mode (server-side ignore.)"],
    [
      "531",
      "alice",
      "You are not permitted to send private messages to this user",
    ],
  ])(
    "reply %s for a message to %s fails with the server's reason",
    async (numeric: string, target: string, reason: string) => {
      const fakeServer: FakeIRCServer = await start({
        privmsgReply: `:${SERVER_NAME} ${numeric} {nick} ${target} :${reason}`,
      });

      const error: Error = await sendAndGetError(
        options(fakeServer, { target: target, joinChannel: false }),
      );

      expect(error.message).toBe(`Could not send to ${target}: ${reason}.`);
    },
  );

  test("an error reply about the channel it has no name for is a refusal too", async () => {
    // UnrealIRCd's 408: the channel takes no colours (+c).
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 408 {nick} #ops :You cannot use colors on this channel. Not sent: \u000304red\u0003`,
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { text: "\u000304red\u0003 alert" }),
    );

    expect(error.message).toBe(
      // The colour codes in the server's words are taken out.
      "Could not send to #ops: You cannot use colors on this channel. Not sent: red.",
    );
  });

  test("an IRCv3 FAIL for the PRIVMSG fails it too", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} FAIL PRIVMSG MESSAGE_REJECTED #ops :Message looks like spam`,
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "Could not send to #ops: Message looks like spam.",
    );
  });

  test("stops sending at the first refusal", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 404 {nick} #ops :Cannot send to channel`,
    });

    await sendAndGetError(
      options(fakeServer, {
        text: "one\ntwo\nthree",
        pacing: { burst: 1, intervalInMs: 300 },
      }),
    );

    expect(
      linesSent(fakeServer).filter((line: string) => {
        return line.startsWith("PRIVMSG");
      }),
    ).toEqual(["PRIVMSG #ops :one"]);
  });

  test("a reply that is no refusal - an away message - is not one", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 301 {nick} alice :Gone fishing`,
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { target: "alice", joinChannel: false }),
    );

    expect(result.linesSent).toBe(1);
  });
});

describe("IRCClient — a refusal after the PONG, as through a bouncer", () => {
  /*
   * ZNC and soju answer a PING themselves, so the PONG comes back before
   * the network has answered the lines in front of it.
   */
  test("still fails the message when it comes a moment after the PONG", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 404 {nick} #ops :Cannot send to nick/channel`,
      privmsgReplyDelayInMs: 150,
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { refusalGraceInMs: 1000 }),
    );

    expect(error.message).toBe(
      "Could not send to #ops: Cannot send to nick/channel.",
    );
    expect(linesSent(fakeServer)).not.toContain("QUIT :Sent from OneUptime");
  });

  test("listens only a moment: a refusal much later than that is not waited for", async () => {
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:${SERVER_NAME} 404 {nick} #ops :Cannot send to nick/channel`,
      privmsgReplyDelayInMs: 1500,
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { refusalGraceInMs: 100 }),
    );

    expect(result.linesSent).toBe(1);
  });

  test("running out of time while listening does not undo a delivered message", async () => {
    const fakeServer: FakeIRCServer = await start();
    const startedAt: number = Date.now();

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { refusalGraceInMs: 10_000, timeoutInMs: 600 }),
    );

    expect(result.linesSent).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("a connection closed while listening ends the wait, the message delivered", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "PING") {
          connection.send(
            `:${SERVER_NAME} PONG ${SERVER_NAME} :${message.params[0]}`,
          );
          connection.close();
          return true;
        }

        return false;
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { refusalGraceInMs: 10_000 }),
    );

    expect(result.linesSent).toBe(1);
  });

  test("by default, for a second", () => {
    expect(IRC_DEFAULT_REFUSAL_GRACE_IN_MS).toBe(1000);
  });
});

describe("IRCClient — pacing, so the server does not take it for a flood", () => {
  test("sends a burst at once, then waits between lines", async () => {
    const fakeServer: FakeIRCServer = await start();

    await IRCClient.sendMessage(
      options(fakeServer, {
        text: "1\n2\n3\n4\n5",
        pacing: { burst: 2, intervalInMs: 150 },
      }),
    );

    const times: Array<number> = fakeServer.lines
      .filter((entry: FakeIRCLine) => {
        return entry.line.startsWith("PRIVMSG");
      })
      .map((entry: FakeIRCLine) => {
        return entry.receivedAt;
      });

    expect(times).toHaveLength(5);
    expect(times[1]! - times[0]!).toBeLessThan(100);

    for (let index: number = 2; index < times.length; index++) {
      // Timers fire a little early or late; the gap is still the pace.
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(120);
    }
  });

  test("by default, four lines at once and then one a second", () => {
    expect(IRC_DEFAULT_PACING).toEqual({ burst: 4, intervalInMs: 1000 });
  });
});

describe("IRCClient — when the server goes away or never answers", () => {
  test("an ERROR from the server fails with its reason", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "USER") {
          connection.send(
            "ERROR :Closing Link: 203.0.113.9 (K-Lined: Spam from this host)",
          );
          connection.close();
          return true;
        }

        return false;
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "The IRC server closed the connection: Closing Link: 203.0.113.9 (K-Lined: Spam from this host).",
    );
  });

  test("a ban at registration fails with the server's words", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "USER") {
          connection.send(
            `:${SERVER_NAME} 465 * :You are banned from this server- Abuse`,
          );
          return true;
        }

        return false;
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      "The IRC server refused the connection: You are banned from this server- Abuse.",
    );
  });

  test("a connection closed mid-way says where it got to", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "JOIN") {
          connection.close();
          return true;
        }

        return false;
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} closed the connection while joining #ops.`,
    );
  });

  test("a server that hangs up without a word hints at TLS", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: (socket: net.Socket) => {
        socket.end();
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} closed the connection without a word. If the port takes TLS connections (6697 usually does), turn off Disable TLS.`,
    );
  });

  test("a server that never welcomes it times out, saying where", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: () => {
        return true;
      },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { timeoutInMs: 400 }),
    );

    expect(error.message).toBe(
      `Timed out after 1 second while registering with the IRC server ${HOST_NAME}:${fakeServer.port}.`,
    );
  });

  test("no PONG means it cannot say the message arrived", async () => {
    const fakeServer: FakeIRCServer = await start({ answerPing: false });

    const error: Error = await sendAndGetError(
      options(fakeServer, { timeoutInMs: 600 }),
    );

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} did not confirm the message within 1 second. It may have been delivered.`,
    );
    expect(linesSent(fakeServer)).toContain("PRIVMSG #ops :Deploy finished");
  });

  test("a server that keeps the connection open after QUIT is closed on", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage) => {
        return message.command === "QUIT";
      },
    });

    const startedAt: number = Date.now();
    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.linesSent).toBe(1);
    // It waits a moment for the server, and then goes anyway.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });

  test("a QUIT the deadline cuts short is still a message delivered", async () => {
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage) => {
        return message.command === "QUIT";
      },
    });

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { timeoutInMs: 700 }),
    );

    expect(result.linesSent).toBe(1);
  });
});

describe("IRCClient — something that is not an IRC server", () => {
  test.each([
    ["a web server", "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"],
    ["an SSH server", "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n"],
    ["a database", "-ERR unknown command 'NICK'\r\n"],
  ])(
    "%s is reported without quoting what it said",
    async (_label: string, answer: string) => {
      const fakeServer: FakeIRCServer = await start({
        onConnect: (socket: net.Socket) => {
          socket.write(answer);
        },
      });

      const error: Error = await sendAndGetError(options(fakeServer));

      expect(error.message).toBe(
        `The server at ${HOST_NAME}:${fakeServer.port} did not answer like an IRC server. Check IRC Server, Port and Disable TLS.`,
      );
    },
  );

  test("a mail server, whose banner looks like IRC, is never quoted either", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: (socket: net.Socket) => {
        socket.write("220 mail.internal.example ESMTP Postfix (Debian)\r\n");
        socket.on("data", () => {
          socket.write("502 5.5.2 Error: command not recognized\r\n");
        });
      },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { timeoutInMs: 500 }),
    );

    expect(error.message).toBe(
      `Timed out after 1 second while registering with the IRC server ${HOST_NAME}:${fakeServer.port}.`,
    );
    expect(error.message).not.toContain("Postfix");
  });

  test("a line longer than IRC allows, with no end, is not IRC", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: (socket: net.Socket) => {
        socket.write(`:${SERVER_NAME} NOTICE * :${"x".repeat(9000)}`);
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toContain("did not answer like an IRC server");
  });

  test("a server that will not stop talking is cut off", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: (socket: net.Socket) => {
        const line: string = `:${SERVER_NAME} NOTICE * :${"x".repeat(480)}\r\n`;
        socket.write(line.repeat(2300));
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      `The IRC server ${HOST_NAME}:${fakeServer.port} sent more than OneUptime reads from one connection.`,
    );
  });

  test("a PING whose token would break the PONG line is not answered", async () => {
    /*
     * Sent once the client's NICK and USER have arrived, so they are on
     * record before the client hangs up on this PING.
     */
    const fakeServer: FakeIRCServer = await start({
      onMessage: (message: FakeIRCMessage, connection: FakeIRCConnection) => {
        if (message.command === "USER") {
          connection.send("PING :abc\rQUIT :injected");
          return true;
        }

        return false;
      },
    });

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toContain("did not answer like an IRC server");
    expect(linesSent(fakeServer)).toContain("NICK OneUptime");
    expect(
      linesSent(fakeServer).some((line: string) => {
        return line.includes("injected") || line.startsWith("PONG");
      }),
    ).toBe(false);
  });
});

describe("IRCClient — nothing it is given can start a line of its own", () => {
  test("a line break in the message starts a new PRIVMSG, never a command", async () => {
    const fakeServer: FakeIRCServer = await start();

    await IRCClient.sendMessage(
      options(fakeServer, {
        text: "bad\r\nQUIT :injected\rPRIVMSG NickServ :DROP\nfine",
      }),
    );

    expect(linesSent(fakeServer)).toEqual(
      expect.arrayContaining([
        "PRIVMSG #ops :bad",
        "PRIVMSG #ops :QUIT :injected",
        "PRIVMSG #ops :PRIVMSG NickServ :DROP",
        "PRIVMSG #ops :fine",
      ]),
    );
    // The only QUIT is the client's own, and nothing went to NickServ.
    expect(
      linesSent(fakeServer).filter((line: string) => {
        return line.startsWith("QUIT") || line.startsWith("PRIVMSG NickServ");
      }),
    ).toEqual(["QUIT :Sent from OneUptime"]);
  });

  test.each([
    ["a channel with a space", { target: "#ops PART" }],
    ["a channel with a line break", { target: "#ops\nPART #ops" }],
    ["a key starting with a colon", { channelKey: ":x" }],
    ["a nickname with a space", { nicknames: ["One Uptime"] }],
  ])(
    "%s is refused before it is sent",
    async (_label: string, overrides: Partial<IRCSendOptions>) => {
      const fakeServer: FakeIRCServer = await start();

      await sendAndGetError(options(fakeServer, overrides));

      expect(
        linesSent(fakeServer).some((line: string) => {
          return line.startsWith("PART") || line.startsWith("PRIVMSG");
        }),
      ).toBe(false);
    },
  );
});

describe("IRCClient — the connection goes only where the guard approved", () => {
  const lookups: Array<string> = [];

  beforeAll(() => {
    lookups.length = 0;
  });

  function watchLookups(): void {
    lookups.length = 0;

    const realLookup: typeof dns.lookup = dns.lookup;

    jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      lookupOptions: unknown,
      callback: unknown,
    ): void => {
      if (net.isIP(hostname) === 0) {
        lookups.push(hostname);
      }

      (realLookup as unknown as (...args: Array<unknown>) => void)(
        hostname,
        lookupOptions,
        callback,
      );
    }) as never);
  }

  test("never looks the server's name up again", async () => {
    const fakeServer: FakeIRCServer = await start();
    watchLookups();

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer),
    );

    expect(result.linesSent).toBe(1);
    expect(lookups).toEqual([]);
  });

  test("falls through to the next approved address when one is down", async () => {
    const fakeServer: FakeIRCServer = await start();
    watchLookups();

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        addresses: [
          { address: "::1", family: 6 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    );

    expect(result.linesSent).toBe(1);
    expect(lookups).toEqual([]);
  });

  test("a refused connection names the server and the address", async () => {
    const fakeServer: FakeIRCServer = await start();
    const port: number = fakeServer.port;
    await fakeServer.close();
    server = undefined;

    const error: Error = await sendAndGetError(options(fakeServer));

    expect(error.message).toBe(
      `Could not connect to the IRC server ${HOST_NAME}:${port}: connect ECONNREFUSED 127.0.0.1:${port}.`,
    );
  });

  test("an IPv6 address is shown in brackets", async () => {
    const fakeServer: FakeIRCServer = await start();
    const port: number = fakeServer.port;
    await fakeServer.close();
    server = undefined;

    const error: Error = await sendAndGetError(
      options(fakeServer, {
        host: "::1",
        addresses: [{ address: "::1", family: 6 }],
      }),
    );

    expect(error.message).toContain(
      `Could not connect to the IRC server [::1]:${port}: `,
    );
  });
});

describe("IRCClient — TLS", () => {
  let certificate: TestCertificate;
  let otherCertificate: TestCertificate;

  beforeAll(() => {
    certificate = createTestCertificate({
      commonName: HOST_NAME,
      dnsNames: [HOST_NAME],
      ipAddresses: ["127.0.0.1"],
    });
    otherCertificate = createTestCertificate({
      commonName: "other.test.invalid",
      dnsNames: ["other.test.invalid"],
    });
  });

  test("connects over TLS, naming the server it expects", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: certificate });
    trust(certificate);
    const log: Array<string> = [];

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, {
        useTls: true,
        log: (message: string) => {
          log.push(message);
        },
      }),
    );

    expect(result.linesSent).toBe(1);
    expect(fakeServer.servernames).toEqual([HOST_NAME]);
    expect(log[0]).toBe(
      `Connecting to the IRC server ${HOST_NAME}:${fakeServer.port} over TLS.`,
    );
    expect(linesSent(fakeServer)).toContain("PRIVMSG #ops :Deploy finished");
  });

  test("checks the certificate: an untrusted one is refused", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: certificate });

    const error: Error = await sendAndGetError(
      options(fakeServer, { useTls: true }),
    );

    expect(error.message).toMatch(
      new RegExp(
        `^The TLS certificate of the IRC server ${HOST_NAME.replace(/\./g, "\\.")}:${fakeServer.port} is not trusted: self-signed certificate`,
      ),
    );
    expect(error.message).toContain(
      "A self-hosted OneUptime can trust a private certificate authority through NODE_EXTRA_CA_CERTS.",
    );
    expect(fakeServer.lines).toEqual([]);
  });

  test("checks the certificate is for the server it meant to reach", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: otherCertificate });
    trust(otherCertificate);

    const error: Error = await sendAndGetError(
      options(fakeServer, { useTls: true }),
    );

    expect(error.message).toContain(
      "is not trusted: Hostname/IP does not match",
    );
    expect(fakeServer.lines).toEqual([]);
  });

  test("an address typed for the server sends no name, and is checked as an address", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: certificate });
    trust(certificate);

    const result: IRCSendResult = await IRCClient.sendMessage(
      options(fakeServer, { useTls: true, host: "127.0.0.1" }),
    );

    expect(result.linesSent).toBe(1);
    expect(fakeServer.servernames).toEqual([false]);
  });

  test("TLS to a server that does not speak it says to check the port", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: (socket: net.Socket) => {
        socket.once("data", () => {
          socket.write(":irc.fake.test 421 * :Unknown command\r\n");
        });
      },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { useTls: true }),
    );

    expect(error.message).toMatch(
      new RegExp(
        `^Could not start TLS with the IRC server ${HOST_NAME.replace(/\./g, "\\.")}:${fakeServer.port}: `,
      ),
    );
    expect(error.message).toContain(
      "Check Port: 6697 is the usual port for TLS, and 6667 for connections without it.",
    );
  });

  test("no TLS to a server that wants it hints at Disable TLS", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: certificate });

    const error: Error = await sendAndGetError(options(fakeServer));

    // Closed, or reset if the client's lines were still unread.
    expect(error.message).toMatch(
      /^(The IRC server .+ closed the connection without a word|Lost the connection to the IRC server .+)\. If the port takes TLS connections \(6697 usually does\), turn off Disable TLS\.$/,
    );
  });

  test("a TLS handshake that never finishes times out while connecting", async () => {
    const fakeServer: FakeIRCServer = await start({
      onConnect: () => {
        // Accepts the connection and then says nothing at all.
      },
    });

    const error: Error = await sendAndGetError(
      options(fakeServer, { useTls: true, timeoutInMs: 400 }),
    );

    expect(error.message).toBe(
      `Timed out after 1 second while connecting to the IRC server ${HOST_NAME}:${fakeServer.port}.`,
    );
  });
});

describe("IRCClient helpers", () => {
  test("nicknames are tried as typed, with underscores, then with a number", () => {
    const candidates: Array<string> = IRCClient.getNicknameCandidates("Bot");

    expect(candidates.slice(0, 3)).toEqual(["Bot", "Bot_", "Bot__"]);
    expect(candidates[3]).toMatch(/^Bot[1-9][0-9]{2}$/);
  });

  test("then the same endings in place of its last characters, for a server whose limit it fills", () => {
    const candidates: Array<string> =
      IRCClient.getNicknameCandidates("OneUptime");

    expect(candidates).toHaveLength(6);
    expect(candidates[4]).toBe("OneUptim_");
    expect(candidates[5]).toMatch(/^OneUpt[1-9][0-9]{2}$/);
    // As long as the nickname itself.
    expect(candidates[5]!.length).toBe("OneUptime".length);
  });

  test("every candidate is a nickname, and none is tried twice", () => {
    for (const nickname of ["a", "ab", "Bot_", "OneUptime", "x".repeat(30)]) {
      const candidates: Array<string> =
        IRCClient.getNicknameCandidates(nickname);

      expect(new Set(candidates).size).toBe(candidates.length);
      expect(candidates[0]).toBe(nickname);

      for (const candidate of candidates) {
        expect({
          candidate,
          valid: IRCValidation.getNicknameProblem(candidate) === null,
        }).toEqual({
          candidate,
          valid: true,
        });
      }
    }
  });

  test("a server's words are quoted without formatting or control codes", () => {
    expect(
      IRCClient.cleanServerText(
        "\u0002Cannot\u0002 join \u000304,01channel\u000f\u0007 \u000312(+b)\u0003 \u0004ff0000,00ff00now",
      ),
    ).toBe("Cannot join channel (+b) now");
  });

  test("a long reason is cut to a sentence's length", () => {
    const cleaned: string = IRCClient.cleanServerText("x".repeat(5000));

    expect(cleaned).toBe(`${"x".repeat(200)}…`);
  });

  test("a reply is described by its last parameter, or its number", () => {
    expect(
      IRCClient.describeReply({
        command: "474",
        params: ["OneUptime", "#ops", "Cannot join channel (+b)"],
      }),
    ).toBe("Cannot join channel (+b)");
    expect(IRCClient.describeReply({ command: "404", params: [] })).toBe(
      "reply 404",
    );
    expect(
      IRCClient.describeReply({
        command: "404",
        params: ["OneUptime", "\u0003"],
      }),
    ).toBe("reply 404");
  });
});
