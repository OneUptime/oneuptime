import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

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
    title: "Send Message to IRC",
    category: "IRC",
    description: "Send message to IRC channel",
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "server",
        name: "IRC Server",
        description:
          "Host name of the IRC server, such as irc.libera.chat. The port goes in Port, under More fields.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "irc.libera.chat",
      },
      {
        id: "channel",
        name: "Channel",
        description: "Channel to post in, such as #ops.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "#ops",
      },
      {
        id: "text",
        name: "Message Text",
        description: `Message to send. Each line is sent as an IRC message of its own, at most ${IRC_MAX_LINES} of them, and IRC formatting codes work.`,
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test IRC message from OneUptime",
      },
      {
        id: "nickname",
        name: "Nickname",
        description: `Nickname to post as. Defaults to ${IRC_DEFAULT_NICKNAME}. If it is taken, an underscore or a number is added.`,
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
        placeholder: IRC_DEFAULT_NICKNAME,
      },
      {
        id: "port",
        name: "Port",
        description: `Port of the IRC server. Defaults to ${IRC_DEFAULT_TLS_PORT}, or to ${IRC_DEFAULT_PLAIN_TEXT_PORT} with Disable TLS on.`,
        type: ComponentInputType.Number,
        required: false,
        isAdvanced: true,
        placeholder: String(IRC_DEFAULT_TLS_PORT),
      },
      {
        id: "disable-tls",
        name: "Disable TLS",
        description:
          "Connect without encryption, for a server that does not offer TLS. Any password is then sent unencrypted.",
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
      {
        id: "channel-key",
        name: "Channel Key",
        description: "Key of a channel that has one (mode +k).",
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
      {
        id: "send-without-joining",
        name: "Send Without Joining",
        description:
          "Post without joining the channel, so the channel does not see the step join and leave. Only works where the channel takes messages from outside (no mode +n).",
        type: ComponentInputType.Boolean,
        required: false,
        isAdvanced: true,
      },
      {
        id: "server-password",
        name: "Server Password",
        description:
          "Password the server or your bouncer asks for when connecting (PASS).",
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
      {
        id: "sasl-username",
        name: "SASL Username",
        description:
          "Account to sign in to with SASL, such as a Libera.Chat account. Goes with SASL Password.",
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
      },
      {
        id: "sasl-password",
        name: "SASL Password",
        description: "Password of the SASL account.",
        type: ComponentInputType.Password,
        required: false,
        isAdvanced: true,
        isSensitive: true,
      },
    ],
    returnValues: [
      {
        id: "error",
        name: "Error",
        description: "Error, if there is any.",
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: "In",
        description:
          "Please connect components to this port for this component to work.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Success",
        description:
          "Runs once the IRC server has taken every line of the message.",
        id: "success",
      },
      {
        title: "Error",
        description: "This is executed when there is an error",
        id: "error",
      },
    ],
  },
];

export default components;
