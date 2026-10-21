import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import MattermostComponents, {
  MATTERMOST_MAX_MESSAGE_LENGTH,
} from "../../../../../Types/Workflow/Components/Mattermost";
import {
  TRUNCATED_TEXT_NOTE,
  fitTextToLength,
} from "../../../../../Utils/MessageFit";
import MattermostWebhook, {
  MattermostError,
  MattermostMessage,
} from "../../../../Utils/Mattermost/MattermostWebhook";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

/*
 * How long the request may take, looking up the server included. A webhook
 * answers in well under a second; the rest is a slow network.
 */
export const MATTERMOST_MAX_STEP_TIME_IN_MS: number = 30 * 1000;

// Less than this left of the workflow's own time, and the step does not start.
export const MATTERMOST_MIN_STEP_TIME_IN_MS: number = 2 * 1000;

// Kept back from the workflow's time, so the run can still record the result.
const WORKFLOW_TIME_MARGIN_IN_MS: number = 2 * 1000;

export interface MattermostSettings {
  // Trimmed, and checked to be an incoming webhook's URL.
  webhookUrl: string;
  // With Message Text cut to fit one post.
  message: MattermostMessage;
  // Whether Message Text was longer than a post, and was cut.
  isTextCut: boolean;
}

export default class SendMessageToChannel extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = MattermostComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.MattermostSendMessageToChannel;
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
     * the run, as a Slack webhook URL that is not Slack's does. What the
     * network or Mattermost does with a message that could have worked takes
     * the Error port.
     */
    let settings: MattermostSettings;

    try {
      settings = SendMessageToChannel.getSettings(args);
    } catch (error) {
      throw options.onError(
        error instanceof Exception
          ? error
          : new BadDataException((error as Error).message),
      );
    }

    if (settings.isTextCut) {
      options.log(
        `Message Text is longer than a Mattermost post can be (${MATTERMOST_MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters), so it was cut to fit and ends with "${TRUNCATED_TEXT_NOTE}".`,
      );
    }

    try {
      await MattermostWebhook.send({
        webhookUrl: settings.webhookUrl,
        message: settings.message,
        timeoutInMs: SendMessageToChannel.getTimeoutInMs(options),
      });

      options.log(
        settings.message.channel
          ? `Mattermost took the message for ${settings.message.channel}.`
          : "Mattermost took the message.",
      );

      return {
        returnValues: {},
        executePort: successPort,
      };
    } catch (error) {
      /*
       * MattermostWebhook's and the address guard's messages are written to
       * be read by the workflow's author, and quote nothing of the webhook's
       * URL. Anything else is a fault of ours, and its message is not shown.
       */
      const errorMessage: string =
        error instanceof MattermostError || error instanceof Exception
          ? error.message
          : "The message could not be sent to Mattermost.";

      options.log(errorMessage);

      return {
        returnValues: { error: errorMessage },
        executePort: errorPort,
      };
    }
  }

  /*
   * Every setting, read and checked. Throws a BadDataException that says
   * what to change, and quotes nothing of the webhook's URL.
   */
  public static getSettings(args: JSONObject): MattermostSettings {
    // A URL pasted or stored with a line break after it is still the URL.
    const webhookUrl: string = SendMessageToChannel.getText(
      args["webhook-url"],
    ).trim();

    const urlProblem: string | null =
      MattermostWebhook.getWebhookUrlProblem(webhookUrl);

    if (urlProblem) {
      throw new BadDataException(urlProblem);
    }

    const rawText: string = SendMessageToChannel.getText(args["text"]);

    if (!rawText) {
      throw new BadDataException("Mattermost message not found.");
    }

    if (!rawText.trim()) {
      throw new BadDataException(
        "Message Text has nothing to send: it is blank.",
      );
    }

    /*
     * Mattermost would split a longer message into as many posts as it
     * takes; one post, ending with a note, is what a channel wants.
     */
    const text: string = fitTextToLength(
      rawText,
      MATTERMOST_MAX_MESSAGE_LENGTH,
    );

    const message: MattermostMessage = { text: text };

    try {
      const channel: string = SendMessageToChannel.getText(args["channel"]);

      if (channel.trim()) {
        message.channel = MattermostWebhook.getChannel(channel);
      }

      const username: string = MattermostWebhook.getUsername(
        SendMessageToChannel.getText(args["username"]),
      );

      if (username) {
        message.username = username;
      }

      const iconUrl: string = SendMessageToChannel.getText(args["icon-url"]);

      if (iconUrl.trim()) {
        message.iconUrl = MattermostWebhook.getIconUrl(iconUrl);
      }
    } catch (error) {
      if (error instanceof MattermostError) {
        throw new BadDataException(error.message);
      }

      throw error;
    }

    return {
      webhookUrl: webhookUrl,
      message: message,
      isTextCut: text !== rawText,
    };
  }

  /*
   * How long the request may take: up to MATTERMOST_MAX_STEP_TIME_IN_MS, and
   * always inside what is left of the workflow's own time.
   */
  public static getTimeoutInMs(options: RunOptions): number {
    const remainingInMs: number =
      options.getRemainingExecutionTimeInMs?.() ??
      MATTERMOST_MAX_STEP_TIME_IN_MS + WORKFLOW_TIME_MARGIN_IN_MS;

    const timeoutInMs: number = Math.min(
      MATTERMOST_MAX_STEP_TIME_IN_MS,
      Math.floor(remainingInMs - WORKFLOW_TIME_MARGIN_IN_MS),
    );

    if (timeoutInMs < MATTERMOST_MIN_STEP_TIME_IN_MS) {
      throw new MattermostError(
        "Not enough of the workflow's run time is left to send a message to Mattermost.",
      );
    }

    return timeoutInMs;
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
}
