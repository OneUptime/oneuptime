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
import DiscordComponents from "../../../../../Types/Workflow/Components/Discord";
import API from "../../../../../Utils/API";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class SendMessageToChannel extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = DiscordComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.DiscordSendMessageToChannel;
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

    if (!args["text"]) {
      throw options.onError(new BadDataException("Discord message not found"));
    }

    if (!args["webhook-url"]) {
      throw options.onError(
        new BadDataException("Discord Webhook URL not found"),
      );
    }

    args["webhook-url"] = URL.fromString(
      args["webhook-url"]?.toString() as string,
    );

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    try {
      // https://discord.com/developers/docs/resources/webhook#execute-webhook
      apiResult = await API.post({
        url: args["webhook-url"] as URL,
        data: {
          content: args["text"] as string,
        },
      });

      if (apiResult instanceof HTTPErrorResponse) {
        return Promise.resolve({
          returnValues: {
            error: apiResult.message || "Server Error.",
          },
          executePort: errorPort,
        });
      }
      return Promise.resolve({
        returnValues: {},
        executePort: successPort,
      });
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        return Promise.resolve({
          returnValues: {
            error: err.message || "Server Error.",
          },
          executePort: errorPort,
        });
      }

      throw options.onError(new APIException("Something wrong happened."));
    }
  }
}
