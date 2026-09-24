import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import TelegramComponents from "../../../../../Types/Workflow/Components/Telegram";
import API from "../../../../../Utils/API";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

/*
 * https://core.telegram.org/bots/api#authorizing-your-bot — a numeric bot id,
 * a ":", then the secret, e.g. "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11".
 */
const TELEGRAM_BOT_TOKEN_REGEX: RegExp = /^\d+:[A-Za-z0-9_-]+$/;

export default class SendMessageToChat extends ComponentCode {
  public static isValidBotToken(botToken: string): boolean {
    return TELEGRAM_BOT_TOKEN_REGEX.test(botToken);
  }

  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = TelegramComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.TelegramSendMessageToChat;
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

    if (!args["bot-token"]) {
      throw options.onError(
        new BadDataException("Telegram Bot Token not found"),
      );
    }

    if (!args["chat-id"]) {
      throw options.onError(new BadDataException("Telegram Chat ID not found"));
    }

    if (!args["text"]) {
      throw options.onError(new BadDataException("Telegram message not found"));
    }

    // A token pasted or stored with a trailing newline is still the token.
    const botToken: string = (args["bot-token"]?.toString() || "").trim();
    const chatId: string = args["chat-id"]?.toString() as string;
    const text: string = args["text"]?.toString() as string;

    /*
     * The token becomes a path segment of the request URL, so anything other
     * than Telegram's "<bot id>:<secret>" shape is refused before it gets
     * there. The message deliberately does not quote the value: the step's
     * error is written to the run log, and the token is a credential. Before
     * this check, a URL parse failure put the whole token into the log.
     */
    if (!SendMessageToChat.isValidBotToken(botToken)) {
      throw options.onError(
        new BadDataException(
          "Telegram Bot Token is not in a valid format. It should look like 123456789:ABCdefGhIJKlmnoPQRstuVWxyz, exactly as BotFather issued it.",
        ),
      );
    }

    const telegramApiUrl: URL = URL.fromString(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
    );

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    try {
      // https://core.telegram.org/bots/api#sendmessage
      apiResult = await API.post({
        url: telegramApiUrl,
        data: {
          chat_id: chatId,
          text: text,
        },
      });

      const helpMessage: string =
        " Note: For usernames, the user must have started a conversation with the bot first. For groups/channels, the bot must be added as a member or admin.";

      if (apiResult instanceof HTTPErrorResponse) {
        // Telegram returns errors in 'description' field
        const telegramError: string =
          (apiResult.data?.["description"] as string) ||
          apiResult.message ||
          "Server Error.";
        return Promise.resolve({
          returnValues: {
            error: telegramError + helpMessage,
          },
          executePort: errorPort,
        });
      }

      // Check if Telegram returned ok: false (some errors return 200 OK)
      if (apiResult.data && apiResult.data["ok"] === false) {
        const telegramError: string =
          (apiResult.data["description"] as string) || "Telegram API Error.";
        return Promise.resolve({
          returnValues: {
            error: telegramError + helpMessage,
          },
          executePort: errorPort,
        });
      }

      return Promise.resolve({
        returnValues: {},
        executePort: successPort,
      });
    } catch (err) {
      const helpMessage: string =
        " Note: For usernames, the user must have started a conversation with the bot first. For groups/channels, the bot must be added as a member or admin.";

      if (err instanceof HTTPErrorResponse) {
        // Telegram returns errors in 'description' field
        const telegramError: string =
          (err.data?.["description"] as string) ||
          err.message ||
          "Server Error.";
        return Promise.resolve({
          returnValues: {
            error: telegramError + helpMessage,
          },
          executePort: errorPort,
        });
      }

      throw options.onError(new APIException("Something wrong happened."));
    }
  }
}
