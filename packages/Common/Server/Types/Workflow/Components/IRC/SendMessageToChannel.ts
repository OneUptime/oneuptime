import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import IRCComponents, {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "../../../../../Types/Workflow/Components/IRC";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../../Utils/DataSource/EgressGuard";
import IRCClient, {
  IRCError,
  IRCSASLCredentials,
} from "../../../../Utils/IRC/IRCClient";
import IRCMessageText, {
  PreparedIRCText,
} from "../../../../Utils/IRC/IRCMessageText";
import IRCValidation from "../../../../Utils/IRC/IRCValidation";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import net from "net";

/*
 * The whole conversation, from connecting to quitting. Fifteen lines at the
 * pace IRCClient keeps take about eleven seconds; the rest is a slow network
 * and a server that looks up our host name and ident before letting us in.
 */
export const IRC_MAX_STEP_TIME_IN_MS: number = 60 * 1000;

// Less than this left of the workflow's own time, and the step does not start.
export const IRC_MIN_STEP_TIME_IN_MS: number = 5 * 1000;

// Kept back from the workflow's time, so the run can still record the result.
const WORKFLOW_TIME_MARGIN_IN_MS: number = 2 * 1000;

// The longest a DNS name can be.
const MAX_HOST_LENGTH: number = 253;

export interface IRCSettings {
  // As typed, without brackets around an IPv6 address or a trailing dot.
  host: string;
  port: number;
  useTls: boolean;
  nickname: string;
  target: string;
  joinChannel: boolean;
  channelKey?: string | undefined;
  serverPassword?: string | undefined;
  sasl?: IRCSASLCredentials | undefined;
  text: PreparedIRCText;
}

export default class SendMessageToChannel extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = IRCComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.IRCSendMessageToChannel;
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

    /*
     * A setting that cannot work is a mistake in the workflow, so it stops
     * the run, as a malformed Telegram token does. What the server or the
     * network does with a message that could have worked takes the Error
     * port.
     */
    let settings: IRCSettings;

    try {
      settings = SendMessageToChannel.getSettings(args);
    } catch (error) {
      throw options.onError(error as Exception);
    }

    if (settings.text.isTruncated) {
      options.log(
        `Message Text is longer than ${IRC_MAX_LINES} IRC lines. The first ${IRC_MAX_LINES - 1} are sent, and a last line says the message was cut short.`,
      );
    }

    try {
      const timeoutInMs: number = SendMessageToChannel.getTimeoutInMs(options);

      /*
       * The IRC server is free text typed by anyone who can edit workflows,
       * and whatever answers is reported back on the Error port, so unchecked
       * this step would be a port scanner for the network the workflow worker
       * runs in. Same guard and policy as the Send Email step's SMTP server:
       * loopback, link-local and cloud metadata are refused everywhere;
       * private ranges on SaaS, and on a self-hosted install that sets
       * DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true. A refusal takes the Error
       * port, before a socket is opened, and IRCClient dials only the
       * addresses approved here.
       */
      const addresses: Array<ResolvedAddress> =
        await DataSourceEgressGuard.assertHostnameAllowed(settings.host, {
          targetLabel: "IRC server",
        });

      await IRCClient.sendMessage({
        host: settings.host,
        port: settings.port,
        addresses: addresses,
        useTls: settings.useTls,
        nicknames: IRCClient.getNicknameCandidates(settings.nickname),
        target: settings.target,
        joinChannel: settings.joinChannel,
        channelKey: settings.channelKey,
        serverPassword: settings.serverPassword,
        sasl: settings.sasl,
        lines: settings.text.lines,
        timeoutInMs: timeoutInMs,
        log: (message: string) => {
          options.log(message);
        },
      });

      return {
        returnValues: {},
        executePort: successPort,
      };
    } catch (error) {
      /*
       * IRCClient's and the egress guard's messages are written to be read by
       * the workflow's author, and quote nothing secret. Anything else is a
       * fault of ours, and its message is not shown.
       */
      const errorMessage: string =
        error instanceof IRCError || error instanceof Exception
          ? error.message
          : "The message could not be sent to IRC.";

      options.log(errorMessage);

      return {
        returnValues: { error: errorMessage },
        executePort: errorPort,
      };
    }
  }

  /*
   * Every setting, read and checked. Throws a BadDataException that says what
   * to change; nothing is quoted back that is secret.
   */
  public static getSettings(args: JSONObject): IRCSettings {
    const host: string = SendMessageToChannel.getHost(
      SendMessageToChannel.getText(args["server"]).trim(),
    );

    const useTls: boolean = !SendMessageToChannel.isOn(args["disable-tls"]);

    const port: number = SendMessageToChannel.getPort(args["port"], useTls);

    const nickname: string =
      SendMessageToChannel.getText(args["nickname"]).trim() ||
      IRC_DEFAULT_NICKNAME;

    SendMessageToChannel.check(IRCValidation.getNicknameProblem(nickname));

    const target: string = SendMessageToChannel.getText(args["channel"]).trim();

    if (!target) {
      throw new BadDataException(
        "IRC Channel not found. Enter the channel to post in, such as #ops.",
      );
    }

    SendMessageToChannel.check(IRCValidation.getChannelProblem(target));

    const joinChannel: boolean = !SendMessageToChannel.isOn(
      args["send-without-joining"],
    );

    // A key opens a channel to JOIN, and nothing else uses it.
    const channelKey: string | undefined = joinChannel
      ? SendMessageToChannel.getText(args["channel-key"]).trim() || undefined
      : undefined;

    if (channelKey) {
      SendMessageToChannel.check(
        IRCValidation.getChannelKeyProblem(channelKey),
      );
    }

    const serverPassword: string | undefined =
      SendMessageToChannel.getSecret(args["server-password"]) || undefined;

    if (serverPassword) {
      SendMessageToChannel.check(
        IRCValidation.getCredentialProblem(serverPassword, "Server Password"),
      );
    }

    const saslUsername: string = SendMessageToChannel.getText(
      args["sasl-username"],
    ).trim();
    const saslPassword: string = SendMessageToChannel.getSecret(
      args["sasl-password"],
    );

    if (Boolean(saslUsername) !== Boolean(saslPassword)) {
      throw new BadDataException(
        "SASL Username and SASL Password go together. Fill in both to sign in with SASL, or neither.",
      );
    }

    if (saslUsername) {
      SendMessageToChannel.check(
        IRCValidation.getCredentialProblem(saslUsername, "SASL Username"),
      );
      SendMessageToChannel.check(
        IRCValidation.getCredentialProblem(saslPassword, "SASL Password"),
      );
    }

    const rawText: string = SendMessageToChannel.getText(args["text"]);

    if (!rawText) {
      throw new BadDataException("IRC message not found.");
    }

    const text: PreparedIRCText = IRCMessageText.prepare({
      text: rawText,
      maxBytesPerLine: IRCMessageText.getMaxTextBytes({
        nickname: IRCClient.getLongestNicknameCandidate(nickname),
        target: target,
      }),
      maxLines: IRC_MAX_LINES,
    });

    if (text.lines.length === 0) {
      throw new BadDataException(
        "Message Text has nothing to send: it is blank, or holds only characters IRC cannot carry.",
      );
    }

    return {
      host: host,
      port: port,
      useTls: useTls,
      nickname: nickname,
      target: target,
      joinChannel: joinChannel,
      channelKey: channelKey,
      serverPassword: serverPassword,
      sasl: saslUsername
        ? { username: saslUsername, password: saslPassword }
        : undefined,
      text: text,
    };
  }

  /*
   * The server's host name or address, as the user meant it: an IPv6
   * address without the brackets it is often written in, and a name without
   * the trailing dot of a fully qualified one. Refuses what is not a host -
   * a URL, a "host:port" - with a sentence that says where those parts go.
   */
  public static getHost(value: string): string {
    if (!value) {
      throw new BadDataException(
        "IRC Server not found. Enter the host name of the IRC server, such as irc.libera.chat.",
      );
    }

    if (value.length > MAX_HOST_LENGTH + 2) {
      throw new BadDataException("IRC Server is too long to be a host name.");
    }

    if (value.includes("://")) {
      throw new BadDataException(
        `IRC Server takes a host name, such as irc.libera.chat, without "irc://" or "ircs://". Put the port in Port, and leave Disable TLS off for TLS.`,
      );
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      const address: string = value.substring(1, value.length - 1);

      if (!net.isIPv6(address)) {
        throw new BadDataException(
          `IRC Server ${IRCValidation.quote(value)} is not an IPv6 address.`,
        );
      }

      return address;
    }

    if (net.isIP(value) !== 0) {
      return value;
    }

    if (value.includes(":")) {
      throw new BadDataException(
        `IRC Server takes the host name only, such as irc.libera.chat. Put the port in Port.`,
      );
    }

    const host: string = value.endsWith(".")
      ? value.substring(0, value.length - 1)
      : value;

    if (host.length === 0 || host.length > MAX_HOST_LENGTH) {
      throw new BadDataException(
        `IRC Server ${IRCValidation.quote(value)} is not a valid host name.`,
      );
    }

    for (const label of host.split(".")) {
      if (!SendMessageToChannel.isHostLabel(label)) {
        throw new BadDataException(
          `IRC Server ${IRCValidation.quote(value)} is not a valid host name.`,
        );
      }
    }

    return host;
  }

  public static getPort(value: JSONValue | undefined, useTls: boolean): number {
    const text: string = SendMessageToChannel.getText(value).trim();

    if (!text) {
      return useTls ? IRC_DEFAULT_TLS_PORT : IRC_DEFAULT_PLAIN_TEXT_PORT;
    }

    const port: number = Number(text);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadDataException(
        "Port must be a whole number from 1 to 65535. IRC servers usually take 6697 for TLS and 6667 for connections without it.",
      );
    }

    return port;
  }

  /*
   * How long the conversation may take: up to IRC_MAX_STEP_TIME_IN_MS, and
   * always inside what is left of the workflow's own time.
   */
  public static getTimeoutInMs(options: RunOptions): number {
    const remainingInMs: number =
      options.getRemainingExecutionTimeInMs?.() ??
      IRC_MAX_STEP_TIME_IN_MS + WORKFLOW_TIME_MARGIN_IN_MS;

    const timeoutInMs: number = Math.min(
      IRC_MAX_STEP_TIME_IN_MS,
      Math.floor(remainingInMs - WORKFLOW_TIME_MARGIN_IN_MS),
    );

    if (timeoutInMs < IRC_MIN_STEP_TIME_IN_MS) {
      throw new IRCError(
        "Not enough of the workflow's run time is left to send a message to IRC.",
      );
    }

    return timeoutInMs;
  }

  // A toggle, or the text a reference left in its place.
  private static isOn(value: JSONValue | undefined): boolean {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  private static getText(value: JSONValue | undefined): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /*
   * A password as typed, but without the line break a value pasted from a
   * file, or saved in a variable that way, so often ends with. Spaces are
   * kept: a password may end with one.
   */
  private static getSecret(value: JSONValue | undefined): string {
    let secret: string = SendMessageToChannel.getText(value);

    while (secret.endsWith("\n") || secret.endsWith("\r")) {
      secret = secret.substring(0, secret.length - 1);
    }

    return secret;
  }

  // Letters, digits, "-" and "_", not starting or ending with "-".
  private static isHostLabel(label: string): boolean {
    if (label.length === 0 || label.length > 63) {
      return false;
    }

    if (label.startsWith("-") || label.endsWith("-")) {
      return false;
    }

    for (let index: number = 0; index < label.length; index++) {
      const character: string = label.charAt(index);
      const isAllowed: boolean =
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z") ||
        (character >= "0" && character <= "9") ||
        character === "-" ||
        character === "_";

      if (!isAllowed) {
        return false;
      }
    }

    return true;
  }

  private static check(problem: string | null): void {
    if (problem) {
      throw new BadDataException(problem);
    }
  }
}
