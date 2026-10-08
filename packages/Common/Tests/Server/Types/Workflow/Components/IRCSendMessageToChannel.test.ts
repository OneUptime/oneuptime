import SendMessageToChannel, {
  IRC_MAX_STEP_TIME_IN_MS,
  IRCSettings,
} from "../../../../../Server/Types/Workflow/Components/IRC/SendMessageToChannel";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import DataSourceEgressGuard from "../../../../../Server/Utils/DataSource/EgressGuard";
import IRCClient, {
  IRCError,
  IRCSendOptions,
  IRCSendResult,
} from "../../../../../Server/Utils/IRC/IRCClient";
import IRCMessageText from "../../../../../Server/Utils/IRC/IRCMessageText";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentType,
  isArgumentRequired,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import IRCComponents, {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "../../../../../Types/Workflow/Components/IRC";
import {
  FakeIRCLine,
  FakeIRCServer,
  FakeIRCServerOptions,
  linesSent,
  startFakeIRCServer,
} from "../../../Utils/IRC/FakeIRCServer";
import {
  TestCertificate,
  createTestCertificate,
} from "../../../Utils/IRC/TestCertificate";
import dns from "dns";
import net from "net";
import tls from "tls";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * "Send Message to IRC" as a workflow step: which settings it reads and how,
 * what stops the run and what takes the Error port, the egress guard in front
 * of the server it is given, and whole runs through the step against an IRC
 * server on 127.0.0.1 - in plain text, over TLS, and signed in.
 */

const metadata: ComponentMetadata = IRCComponents.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.IRCSendMessageToChannel;
  },
)!;

interface LoggedRun {
  options: RunOptions;
  logged: Array<string>;
}

function makeRun(remainingInMs?: number): LoggedRun {
  const logged: Array<string> = [];

  const options: RunOptions = {
    log: ((item: unknown) => {
      logged.push(item instanceof Error ? item.message : String(item));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  if (remainingInMs !== undefined) {
    options.getRemainingExecutionTimeInMs = (): number => {
      return remainingInMs;
    };
  }

  return { options, logged };
}

function args(overrides: JSONObject = {}): JSONObject {
  return {
    server: "irc.libera.chat",
    channel: "#ops",
    text: "Deploy finished",
    ...overrides,
  };
}

function settingsFor(overrides: JSONObject = {}): IRCSettings {
  return SendMessageToChannel.getSettings(args(overrides));
}

function settingsError(overrides: JSONObject): string {
  try {
    SendMessageToChannel.getSettings(args(overrides));
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("Expected the settings to be refused");
}

async function runAndGetThrown(
  runArgs: JSONObject,
  run: LoggedRun = makeRun(),
): Promise<Error> {
  try {
    await new SendMessageToChannel().run(runArgs, run.options);
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the run to stop");
}

const previousEnvironment: Record<string, string | undefined> = {};

function setEnvironment(name: string, value: string | undefined): void {
  if (!(name in previousEnvironment)) {
    previousEnvironment[name] = process.env[name];
  }

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  jest.restoreAllMocks();

  for (const name of Object.keys(previousEnvironment)) {
    const value: string | undefined = previousEnvironment[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }

    delete previousEnvironment[name];
  }
});

describe("Send Message to IRC — the step", () => {
  test("is offered with the other chat steps, under IRC", () => {
    expect(metadata).toBeDefined();
    expect(metadata.title).toBe("Send Message to IRC");
    expect(metadata.category).toBe("IRC");
    expect(metadata.componentType).toBe(ComponentType.Component);
    expect(Components).toContain(metadata);
  });

  test("asks up front only for the server, the channel and the message", () => {
    const upFront: Array<string> = metadata.arguments
      .filter((argument: Argument) => {
        return !argument.isAdvanced;
      })
      .map((argument: Argument) => {
        return argument.id;
      });

    expect(upFront).toEqual(["server", "channel", "text"]);

    for (const argument of metadata.arguments) {
      expect({
        id: argument.id,
        required: isArgumentRequired(argument, {}),
      }).toEqual({
        id: argument.id,
        required: upFront.includes(argument.id),
      });
    }
  });

  test("everything else is under More fields", () => {
    expect(
      metadata.arguments
        .filter((argument: Argument) => {
          return argument.isAdvanced;
        })
        .map((argument: Argument) => {
          return argument.name;
        }),
    ).toEqual([
      "Nickname",
      "Port",
      "Disable TLS",
      "Channel Key",
      "Send Without Joining",
      "Server Password",
      "SASL Username",
      "SASL Password",
    ]);
  });

  test("hides every password from the run log, and nothing else", () => {
    const sensitive: Array<string> = metadata.arguments
      .filter((argument: Argument) => {
        return argument.isSensitive;
      })
      .map((argument: Argument) => {
        return argument.id;
      });

    expect(sensitive).toEqual([
      "channel-key",
      "server-password",
      "sasl-password",
    ]);
  });

  test("says where it goes next, and why on Error", () => {
    expect(
      metadata.outPorts.map((port: { id: string }) => {
        return port.id;
      }),
    ).toEqual(["success", "error"]);
    expect(metadata.returnValues).toEqual([
      expect.objectContaining({ id: "error", name: "Error" }),
    ]);
  });

  test("its descriptions state the defaults the step uses", () => {
    const byId: (id: string) => Argument = (id: string): Argument => {
      return metadata.arguments.find((argument: Argument) => {
        return argument.id === id;
      })!;
    };

    expect(byId("port").description).toContain(
      `Defaults to ${IRC_DEFAULT_TLS_PORT}, or to ${IRC_DEFAULT_PLAIN_TEXT_PORT} with Disable TLS on.`,
    );
    expect(byId("nickname").description).toContain(
      `Defaults to ${IRC_DEFAULT_NICKNAME}.`,
    );
    expect(byId("text").description).toContain(`at most ${IRC_MAX_LINES}`);
  });
});

describe("Send Message to IRC — reading the settings", () => {
  test("defaults suit a public network: TLS on 6697, as OneUptime, joining the channel", () => {
    const settings: IRCSettings = settingsFor();

    expect(settings).toEqual({
      host: "irc.libera.chat",
      port: 6697,
      useTls: true,
      nickname: "OneUptime",
      target: "#ops",
      joinChannel: true,
      channelKey: undefined,
      serverPassword: undefined,
      sasl: undefined,
      text: { lines: ["Deploy finished"], isTruncated: false },
    });
  });

  test.each([true, "true", 1, "1"])(
    "Disable TLS (%j) connects without TLS, on 6667 by default",
    (value: boolean | string | number) => {
      const settings: IRCSettings = settingsFor({ "disable-tls": value });

      expect(settings.useTls).toBe(false);
      expect(settings.port).toBe(6667);
    },
  );

  test.each([false, "false", 0, ""])(
    "Disable TLS left off (%j) keeps TLS",
    (value: boolean | string | number) => {
      expect(settingsFor({ "disable-tls": value }).useTls).toBe(true);
    },
  );

  test.each([
    [7000, 7000],
    ["7000", 7000],
    [" 6697 ", 6697],
    [1, 1],
    [65535, 65535],
  ])("Port %j is %j", (value: number | string, expected: number) => {
    expect(settingsFor({ port: value }).port).toBe(expected);
  });

  test.each([0, "0", 65536, "-1", "6697.5", "abc", "66 97"])(
    "Port %j is refused",
    (value: number | string) => {
      expect(settingsError({ port: value })).toBe(
        "Port must be a whole number from 1 to 65535. IRC servers usually take 6697 for TLS and 6667 for connections without it.",
      );
    },
  );

  test.each([
    ["  irc.libera.chat  ", "irc.libera.chat"],
    ["irc.libera.chat.", "irc.libera.chat"],
    ["IRC.OFTC.NET", "IRC.OFTC.NET"],
    ["irc_internal", "irc_internal"],
    ["203.0.113.5", "203.0.113.5"],
    ["2001:db8::6667", "2001:db8::6667"],
    ["[2001:db8::6667]", "2001:db8::6667"],
  ])("IRC Server %j is %j", (value: string, host: string) => {
    expect(settingsFor({ server: value }).host).toBe(host);
  });

  test.each([
    [
      "a URL",
      "ircs://irc.libera.chat:6697",
      'IRC Server takes a host name, such as irc.libera.chat, without "irc://" or "ircs://". Put the port in Port, and leave Disable TLS off for TLS.',
    ],
    [
      "a host and port",
      "irc.libera.chat:6697",
      "IRC Server takes the host name only, such as irc.libera.chat. Put the port in Port.",
    ],
    [
      "words",
      "the libera server",
      'IRC Server "the libera server" is not a valid host name.',
    ],
    [
      "an empty label",
      "irc..libera.chat",
      'IRC Server "irc..libera.chat" is not a valid host name.',
    ],
    [
      "a label starting with a dash",
      "-irc.example.com",
      'IRC Server "-irc.example.com" is not a valid host name.',
    ],
    [
      "a path",
      "irc.libera.chat/#ops",
      'IRC Server "irc.libera.chat/#ops" is not a valid host name.',
    ],
    [
      "brackets around something else",
      "[irc.libera.chat]",
      'IRC Server "[irc.libera.chat]" is not an IPv6 address.',
    ],
    [
      "a line break",
      "irc.libera.chat\r\nQUIT",
      'IRC Server "irc.libera.chat??QUIT" is not a valid host name.',
    ],
    [
      "nothing",
      "   ",
      "IRC Server not found. Enter the host name of the IRC server, such as irc.libera.chat.",
    ],
  ])(
    "IRC Server with %s is refused",
    (_label: string, value: string, message: string) => {
      expect(settingsError({ server: value })).toBe(message);
    },
  );

  test("an IRC Server too long to be a host name is refused", () => {
    expect(settingsError({ server: `${"a".repeat(300)}.com` })).toBe(
      "IRC Server is too long to be a host name.",
    );
    expect(settingsError({ server: `${"a.".repeat(126)}com` })).toMatch(
      /is not a valid host name\.$/,
    );
    expect(settingsError({ server: `${"a".repeat(64)}.com` })).toMatch(
      /is not a valid host name\.$/,
    );
  });

  test("a missing IRC Server says what to enter", () => {
    expect(() => {
      return SendMessageToChannel.getSettings({ channel: "#ops", text: "hi" });
    }).toThrow(
      "IRC Server not found. Enter the host name of the IRC server, such as irc.libera.chat.",
    );
  });

  test("Nickname: as typed, trimmed, and checked", () => {
    expect(settingsFor({ nickname: "  deploy-bot " }).nickname).toBe(
      "deploy-bot",
    );
    expect(settingsFor({ nickname: "   " }).nickname).toBe(
      IRC_DEFAULT_NICKNAME,
    );
    expect(settingsError({ nickname: "deploy bot" })).toMatch(
      /^"deploy bot" is not a valid IRC nickname\./,
    );
    expect(settingsError({ nickname: "9lives" })).toMatch(
      /is not a valid IRC nickname/,
    );
  });

  test("Channel: a channel is joined, a nickname is messaged", () => {
    expect(settingsFor({ channel: " #ops " })).toMatchObject({
      target: "#ops",
      joinChannel: true,
    });
    expect(settingsFor({ channel: "alice" })).toMatchObject({
      target: "alice",
      joinChannel: false,
    });
  });

  test("Channel: missing or unusable says what to enter", () => {
    expect(settingsError({ channel: "" })).toBe(
      "IRC Channel not found. Enter the channel to post in, such as #ops.",
    );
    expect(settingsError({ channel: "#ops,#dev" })).toMatch(
      /is not a valid IRC channel name/,
    );
    expect(settingsError({ channel: "ops team" })).toBe(
      'Channel "ops team" is neither a channel, which starts with #, nor a nickname.',
    );
  });

  test("Send Without Joining skips the JOIN, and with it the key", () => {
    expect(
      settingsFor({ "send-without-joining": true, "channel-key": "hunter2" }),
    ).toMatchObject({ joinChannel: false, channelKey: undefined });
  });

  test("Channel Key: used to join, and refused without being quoted", () => {
    expect(settingsFor({ "channel-key": " hunter2\n" }).channelKey).toBe(
      "hunter2",
    );
    expect(
      settingsFor({ channel: "alice", "channel-key": "hunter2" }).channelKey,
    ).toBe(undefined);

    const message: string = settingsError({ "channel-key": "hunter 2" });

    expect(message).toBe(
      "Channel Key cannot hold spaces, commas or control characters.",
    );
  });

  test("Server Password: kept as typed, but without a trailing line break", () => {
    expect(
      settingsFor({ "server-password": " s3cret pass \r\n" }).serverPassword,
    ).toBe(" s3cret pass ");
    expect(settingsFor({ "server-password": "" }).serverPassword).toBe(
      undefined,
    );
    expect(settingsError({ "server-password": "s3cret\nQUIT" })).toBe(
      "Server Password cannot hold a line break or a NUL character.",
    );
  });

  test("SASL: both or neither", () => {
    expect(
      settingsFor({
        "sasl-username": " oneuptime-bot ",
        "sasl-password": "correct horse\n",
      }).sasl,
    ).toEqual({ username: "oneuptime-bot", password: "correct horse" });

    for (const half of [
      { "sasl-username": "oneuptime-bot" },
      { "sasl-password": "correct horse" },
    ]) {
      expect(settingsError(half)).toBe(
        "SASL Username and SASL Password go together. Fill in both to sign in with SASL, or neither.",
      );
    }

    expect(
      settingsError({ "sasl-username": "bot\0admin", "sasl-password": "x" }),
    ).toBe("SASL Username cannot hold a line break or a NUL character.");
  });

  test("Message Text: missing, or with nothing IRC can carry, stops the run", () => {
    expect(settingsError({ text: "" })).toBe("IRC message not found.");
    expect(settingsError({ text: "\n \t\n\u0001" })).toBe(
      "Message Text has nothing to send: it is blank, or holds only characters IRC cannot carry.",
    );
  });

  test("Message Text from a reference that holds an object or a number is sent as text", () => {
    expect(
      settingsFor({ text: { status: "down", count: 2 } }).text.lines,
    ).toEqual(['{"status":"down","count":2}']);
    expect(settingsFor({ text: 42 }).text.lines).toEqual(["42"]);
  });

  test("Message Text: each line a message, sized for the longest nickname it may use", () => {
    const longText: string = "word ".repeat(400);
    const settings: IRCSettings = settingsFor({
      nickname: "a-rather-long-nickname",
      channel: "#a-rather-long-channel-name",
      text: `first\r\nsecond\n${longText}`,
    });
    const maxBytes: number = IRCMessageText.getMaxTextBytes({
      nickname: IRCClient.getLongestNicknameCandidate("a-rather-long-nickname"),
      target: "#a-rather-long-channel-name",
    });

    expect(settings.text.lines.slice(0, 2)).toEqual(["first", "second"]);

    for (const line of settings.text.lines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(maxBytes);
    }
  });

  test(`Message Text longer than ${IRC_MAX_LINES} lines is cut, and says so`, () => {
    const settings: IRCSettings = settingsFor({
      text: Array.from({ length: 30 }, (_: unknown, index: number) => {
        return `line ${index}`;
      }).join("\n"),
    });

    expect(settings.text.isTruncated).toBe(true);
    expect(settings.text.lines).toHaveLength(IRC_MAX_LINES);
  });
});

describe("Send Message to IRC — how long it may take", () => {
  test("up to a minute when nothing says otherwise", () => {
    expect(SendMessageToChannel.getTimeoutInMs(makeRun().options)).toBe(
      IRC_MAX_STEP_TIME_IN_MS,
    );
    expect(
      SendMessageToChannel.getTimeoutInMs(makeRun(10 * 60_000).options),
    ).toBe(IRC_MAX_STEP_TIME_IN_MS);
  });

  test("inside what is left of the workflow's time, with a margin", () => {
    expect(SendMessageToChannel.getTimeoutInMs(makeRun(30_000).options)).toBe(
      28_000,
    );
  });

  test("not at all when only a few seconds are left", () => {
    expect(() => {
      return SendMessageToChannel.getTimeoutInMs(makeRun(6_000).options);
    }).toThrow(
      "Not enough of the workflow's run time is left to send a message to IRC.",
    );
  });
});

describe("Send Message to IRC — what the run does with it", () => {
  let guardSpy: SpyInstance<typeof DataSourceEgressGuard.assertHostnameAllowed>;
  let sendSpy: SpyInstance<typeof IRCClient.sendMessage>;

  beforeEach(() => {
    guardSpy = jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockResolvedValue([{ address: "198.51.100.7", family: 4 }]);
    sendSpy = jest
      .spyOn(IRCClient, "sendMessage")
      .mockResolvedValue({ nickname: "OneUptime", linesSent: 1 });
  });

  function sentOptions(): IRCSendOptions {
    return sendSpy.mock.calls[0]![0] as IRCSendOptions;
  }

  test("checks the server with the egress guard, as the IRC server", async () => {
    await new SendMessageToChannel().run(args(), makeRun().options);

    expect(guardSpy).toHaveBeenCalledWith("irc.libera.chat", {
      targetLabel: "IRC server",
    });
  });

  test("connects only to the addresses the guard approved, with every setting", async () => {
    const run: LoggedRun = makeRun(90_000);

    const result: RunReturnType = await new SendMessageToChannel().run(
      args({
        nickname: "deploy-bot",
        "channel-key": "hunter2",
        "server-password": "bouncer-pass",
        "sasl-username": "deploy",
        "sasl-password": "correct horse",
        text: "one\ntwo",
      }),
      run.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({});

    const sent: IRCSendOptions = sentOptions();

    expect(sent).toMatchObject({
      host: "irc.libera.chat",
      port: 6697,
      addresses: [{ address: "198.51.100.7", family: 4 }],
      useTls: true,
      target: "#ops",
      joinChannel: true,
      channelKey: "hunter2",
      serverPassword: "bouncer-pass",
      sasl: { username: "deploy", password: "correct horse" },
      lines: ["one", "two"],
      timeoutInMs: IRC_MAX_STEP_TIME_IN_MS,
    });
    expect(sent.nicknames.slice(0, 3)).toEqual([
      "deploy-bot",
      "deploy-bot_",
      "deploy-bot__",
    ]);
  });

  test("passes the client's progress on to the run log", async () => {
    sendSpy.mockImplementation(async (sendOptions: IRCSendOptions) => {
      sendOptions.log?.("Joined #ops.");
      return { nickname: "OneUptime", linesSent: 1 } as IRCSendResult;
    });
    const run: LoggedRun = makeRun();

    await new SendMessageToChannel().run(args(), run.options);

    expect(run.logged).toEqual(["Joined #ops."]);
  });

  test("a server the guard refuses takes Error, and nothing is dialed", async () => {
    guardSpy.mockRestore();
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      args({ server: "127.0.0.1" }),
      run.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "IRC server host 127.0.0.1 is not allowed: loopback address.",
    );
    expect(run.logged).toContain(
      "IRC server host 127.0.0.1 is not allowed: loopback address.",
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("the cloud metadata address is refused everywhere", async () => {
    guardSpy.mockRestore();
    setEnvironment("BILLING_ENABLED", "false");

    const result: RunReturnType = await new SendMessageToChannel().run(
      args({ server: "169.254.169.254" }),
      makeRun().options,
    );

    expect(result.returnValues["error"]).toBe(
      "IRC server host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("a private network address is refused on OneUptime Cloud", async () => {
    guardSpy.mockRestore();
    setEnvironment("BILLING_ENABLED", "true");

    const result: RunReturnType = await new SendMessageToChannel().run(
      args({ server: "10.0.0.5" }),
      makeRun().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "IRC server host 10.0.0.5 is not allowed: private network address.",
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("and reached by a self-hosted install, unless it says otherwise", async () => {
    guardSpy.mockRestore();
    setEnvironment("BILLING_ENABLED", "false");
    setEnvironment("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", "false");

    await new SendMessageToChannel().run(
      args({ server: "10.0.0.5" }),
      makeRun().options,
    );

    expect(sentOptions().addresses).toEqual([
      { address: "10.0.0.5", family: 4 },
    ]);

    setEnvironment("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", "true");
    sendSpy.mockClear();

    const result: RunReturnType = await new SendMessageToChannel().run(
      args({ server: "10.0.0.5" }),
      makeRun().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("what the IRC server refused takes Error, in the client's words", async () => {
    sendSpy.mockRejectedValue(
      new IRCError(
        "Could not join #ops: Cannot join channel (+b) - you are banned.",
      ),
    );
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      args(),
      run.options,
    );

    expect(result).toEqual({
      returnValues: {
        error:
          "Could not join #ops: Cannot join channel (+b) - you are banned.",
      },
      executePort: expect.objectContaining({ id: "error" }),
    });
    expect(run.logged).toContain(
      "Could not join #ops: Cannot join channel (+b) - you are banned.",
    );
  });

  test("a fault of ours takes Error without showing its message", async () => {
    sendSpy.mockRejectedValue(new Error("internal: socket state 0x7f"));

    const result: RunReturnType = await new SendMessageToChannel().run(
      args(),
      makeRun().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "The message could not be sent to IRC.",
    );
  });

  test("too little of the workflow's time left takes Error, before connecting", async () => {
    const result: RunReturnType = await new SendMessageToChannel().run(
      args(),
      makeRun(3_000).options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Not enough of the workflow's run time is left to send a message to IRC.",
    );
    expect(guardSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test.each([
    [{ server: "" }, "IRC Server not found."],
    [{ channel: "" }, "IRC Channel not found."],
    [{ text: "" }, "IRC message not found."],
    [{ port: "99999" }, "Port must be a whole number from 1 to 65535."],
  ])(
    "a setting that cannot work stops the run: %j",
    async (overrides: JSONObject, start: string) => {
      const error: Error = await runAndGetThrown(args(overrides));

      expect(error.message.startsWith(start)).toBe(true);
      expect(guardSpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    },
  );

  test("a message cut short says so in the run log", async () => {
    const run: LoggedRun = makeRun();

    await new SendMessageToChannel().run(
      args({ text: "line\n".repeat(40) }),
      run.options,
    );

    expect(run.logged).toContain(
      `Message Text is longer than ${IRC_MAX_LINES} IRC lines. The first ${IRC_MAX_LINES - 1} are sent, and a last line says the message was cut short.`,
    );
    expect(sentOptions().lines).toHaveLength(IRC_MAX_LINES);
  });

  test("Disable TLS dials 6667 without TLS", async () => {
    await new SendMessageToChannel().run(
      args({ "disable-tls": true }),
      makeRun().options,
    );

    expect(sentOptions()).toMatchObject({ port: 6667, useTls: false });
  });
});

describe("Send Message to IRC — whole runs against an IRC server", () => {
  const HOST_NAME: string = "irc.example.invalid";

  let server: FakeIRCServer | undefined;
  let certificate: TestCertificate;
  const lookups: Array<string> = [];

  beforeAll(() => {
    certificate = createTestCertificate({
      commonName: HOST_NAME,
      dnsNames: [HOST_NAME],
    });
  });

  beforeEach(() => {
    lookups.length = 0;

    // The guard "approves" loopback, the one address a test can listen on.
    jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const realLookup: typeof dns.lookup = dns.lookup;

    jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      lookupOptions: unknown,
      callback: unknown,
    ): void => {
      if (net.isIP(hostname) === 0) {
        lookups.push(hostname);
      }

      (realLookup as unknown as (...lookupArgs: Array<unknown>) => void)(
        hostname,
        lookupOptions,
        callback,
      );
    }) as never);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  async function start(
    options: FakeIRCServerOptions = {},
  ): Promise<FakeIRCServer> {
    server = await startFakeIRCServer(options);
    return server;
  }

  function trustCertificate(): void {
    const realConnect: typeof tls.connect = tls.connect;

    jest.spyOn(tls, "connect").mockImplementation(((
      connectOptions: tls.ConnectionOptions,
    ) => {
      return realConnect({ ...connectOptions, ca: [certificate.cert] });
    }) as never);
  }

  test("posts a message over TLS, every line of it, and takes Success", async () => {
    const fakeServer: FakeIRCServer = await start({ tls: certificate });
    trustCertificate();
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        channel: "#ops",
        text: "🚨 Incident #42 declared\nTitle: Database is down\nSeverity: Critical",
      },
      run.options,
    );

    expect(result.returnValues).toEqual({});
    expect(result.executePort?.id).toBe("success");
    expect(fakeServer.servernames).toEqual([HOST_NAME]);
    expect(linesSent(fakeServer)).toEqual([
      "NICK OneUptime",
      "USER oneuptime 0 * :OneUptime",
      "JOIN #ops",
      "PRIVMSG #ops :🚨 Incident #42 declared",
      "PRIVMSG #ops :Title: Database is down",
      "PRIVMSG #ops :Severity: Critical",
      "PING :<token>",
      "QUIT :Sent from OneUptime",
    ]);
    expect(run.logged).toEqual([
      `Connecting to the IRC server ${HOST_NAME}:${fakeServer.port} over TLS.`,
      'Registered with the IRC server as "OneUptime".',
      "Joined #ops.",
      "Sent 3 lines to #ops.",
    ]);
    // The name was checked once, by the guard, and never looked up again.
    expect(lookups).toEqual([]);
  });

  test("signs in, joins a keyed channel and keeps every secret out of the log", async () => {
    const fakeServer: FakeIRCServer = await start({
      tls: certificate,
      password: "bouncer-pass",
      sasl: { username: "deploy", password: "correct horse battery" },
      channelKey: "hunter2",
      takenNicknames: ["deploy-bot"],
    });
    trustCertificate();
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: String(fakeServer.port),
        channel: "#ops",
        text: "Deploy finished",
        nickname: "deploy-bot",
        "channel-key": "hunter2",
        "server-password": "bouncer-pass",
        "sasl-username": "deploy",
        "sasl-password": "correct horse battery",
      },
      run.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(linesSent(fakeServer)).toEqual(
      expect.arrayContaining([
        "PASS bouncer-pass",
        "NICK deploy-bot",
        "NICK deploy-bot_",
        "CAP END",
        "JOIN #ops hunter2",
        "PRIVMSG #ops :Deploy finished",
      ]),
    );
    expect(run.logged).toContain('Signed in with SASL as "deploy".');

    for (const line of run.logged) {
      for (const secret of [
        "bouncer-pass",
        "correct horse battery",
        "hunter2",
      ]) {
        expect(line).not.toContain(secret);
      }
    }
  });

  test("a refusal from the server takes Error with the server's reason", async () => {
    const fakeServer: FakeIRCServer = await start({
      joinReply:
        ":irc.fake.test 474 {nick} #ops :Cannot join channel (+b) - you are banned",
    });
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        "disable-tls": true,
        channel: "#ops",
        text: "Deploy finished",
      },
      run.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Could not join #ops: Cannot join channel (+b) - you are banned.",
    );
    expect(run.logged).toContain(
      "Could not join #ops: Cannot join channel (+b) - you are banned.",
    );
  });

  test("a message that tries to smuggle in commands is sent as text, line by line", async () => {
    const fakeServer: FakeIRCServer = await start();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        "disable-tls": true,
        channel: "#ops",
        text: "Deploy done\r\nQUIT :bye\r\nPRIVMSG NickServ :DROP OneUptime\u0000\n\u0001VERSION\u0001",
      },
      makeRun().options,
    );

    expect(result.executePort?.id).toBe("success");

    const sent: Array<string> = fakeServer.lines.map((entry: FakeIRCLine) => {
      return entry.line;
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        "PRIVMSG #ops :Deploy done",
        "PRIVMSG #ops :QUIT :bye",
        "PRIVMSG #ops :PRIVMSG NickServ :DROP OneUptime",
        "PRIVMSG #ops :VERSION",
      ]),
    );
    // The only QUIT is the step's own, and nothing went to NickServ.
    expect(
      sent.filter((line: string) => {
        return line.startsWith("QUIT");
      }),
    ).toEqual(["QUIT :Sent from OneUptime"]);
    expect(
      sent.some((line: string) => {
        return line.startsWith("PRIVMSG NickServ");
      }),
    ).toBe(false);
  });

  test("a message to one person is sent without joining a channel", async () => {
    const fakeServer: FakeIRCServer = await start();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        "disable-tls": true,
        channel: "alice",
        text: "Your deploy finished",
      },
      makeRun().options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(linesSent(fakeServer)).toContain(
      "PRIVMSG alice :Your deploy finished",
    );
    expect(
      linesSent(fakeServer).some((line: string) => {
        return line.startsWith("JOIN");
      }),
    ).toBe(false);
  });
});
