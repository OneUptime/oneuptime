import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

export const IRC_DEFAULT_NICKNAME: string = "OneUptime";
export const IRC_DEFAULT_TLS_PORT: number = 6697;
export const IRC_DEFAULT_PLAIN_TEXT_PORT: number = 6667;

/*
 * The most IRC lines one message is sent as. A server disconnects a client
 * that floods it, and a channel does not want an essay; a message longer than
 * this is cut, and its last line says so.
 */
export const IRC_MAX_LINES: number = 15;

/*
 * IRC has no webhooks, so this step connects to the server itself, joins the
 * channel, sends the message and leaves (Server/Utils/IRC/IRCClient). The
 * three settings every message needs come first; how to connect and sign in
 * is under More fields, where the defaults suit a public network such as
 * Libera.Chat.
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.IRCSendMessageToChannel,
    title: translationKey("Send Message to IRC"),
    category: translationKey("IRC"),
    description: translationKey("Send message to IRC channel"),
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "server",
        name: translationKey("IRC Server"),
        description: translationKey(
          "Host name of the IRC server, such as irc.libera.chat. The port goes in Port, under More fields.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "irc.libera.chat",
      },
      {
        id: "channel",
        name: translationKey("Channel"),
        description: translationKey("Channel to post in, such as #ops."),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "#ops",
      },
      {
        id: "text",
        name: translationKey("Message Text"),
        /*
         * Written out, so the Dashboard's locales can word it; a test holds
         * the number to the constant it names (WorkflowStepWords).
         */
        description: translationKey(
          "Message to send. Each line is sent as an IRC message of its own, at most 15 of them, and IRC formatting codes work.",
        ),
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test IRC message from OneUptime",
      },
      {
        id: "nickname",
        name: translationKey("Nickname"),
        description: translationKey(
          "Nickname to post as. Defaults to OneUptime. If it is taken, an underscore or a number is added.",
        ),
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
        placeholder: IRC_DEFAULT_NICKNAME,
      },
      {
        id: "port",
        name: translationKey("Port"),
        description: translationKey(
          "Port of the IRC server. Defaults to 6697, or to 6667 with Disable TLS on.",
        ),
        type: ComponentInputType.Number,
        required: false,
        isAdvanced: true,
        placeholder: String(IRC_DEFAULT_TLS_PORT),
      },
      {
        id: "disable-tls",
        name: translationKey("Disable TLS"),
        description: translationKey(
          "Connect without encryption, for a server that does not offer TLS. Any password is then sent unencrypted.",
        ),
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
      {
        id: "channel-key",
        name: translationKey("Channel Key"),
        description: translationKey("Key of a channel that has one (mode +k)."),
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
      {
        id: "send-without-joining",
        name: translationKey("Send Without Joining"),
        description: translationKey(
          "Post without joining the channel, so the channel does not see the step join and leave. Only works where the channel takes messages from outside (no mode +n).",
        ),
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
      {
        id: "server-password",
        name: translationKey("Server Password"),
        description: translationKey(
          "Password the server or your bouncer asks for when connecting (PASS).",
        ),
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
      {
        id: "sasl-username",
        name: translationKey("SASL Username"),
        description: translationKey(
          "Account to sign in to with SASL, such as a Libera.Chat account. Goes with SASL Password.",
        ),
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
      },
      {
        id: "sasl-password",
        name: translationKey("SASL Password"),
        description: translationKey("Password of the SASL account."),
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Please connect components to this port for this component to work.",
        ),
        id: "in",
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "Runs once the IRC server has taken every line of the message.",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey("This is executed when there is an error"),
        id: "error",
      },
    ],
  },
];

export default components;
