import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import SMSEagleComponents from "../../../../../Types/Workflow/Components/SMSEagle";
import API from "../../../../../Utils/API";
import SSRFProtection from "../../../../Utils/SSRFProtection";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class MakeCall extends ComponentCode {
  public static getErrorMessage(response: HTTPErrorResponse): string {
    const message: JSONValue | undefined = response.data?.["message"];

    if (message && typeof message === "object") {
      return Object.entries(message as JSONObject)
        .map(([parameter, error]: [string, JSONValue]) => {
          return `${parameter}: ${error}`;
        })
        .join("; ");
    }

    return (
      (message as string) ||
      `SMSEagle answered with HTTP ${response.statusCode}.`
    );
  }

  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = SMSEagleComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.SMSEagleMakeCall;
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

    if (!args["api-url"]) {
      throw options.onError(new BadDataException("SMSEagle URL not found"));
    }

    if (!args["access-token"]) {
      throw options.onError(
        new BadDataException("SMSEagle Access Token not found"),
      );
    }

    if (!args["to"]) {
      throw options.onError(new BadDataException("Phone Number not found"));
    }

    if (!args["voice-id"]) {
      throw options.onError(new BadDataException("Voice ID not found"));
    }

    if (args["voice-id"] && typeof args["voice-id"] === "string") {
      args["voice-id"] = parseInt(args["voice-id"]);
    }

    if (
      typeof args["voice-id"] !== "number" ||
      isNaN(args["voice-id"] as number)
    ) {
      throw options.onError(
        new BadDataException("Voice ID is not type of number"),
      );
    }

    if (!args["text"]) {
      throw options.onError(new BadDataException("Text to read out not found"));
    }

    const apiUrl: string = (args["api-url"]?.toString() || "").trim();
    // A token pasted or stored with a trailing newline is still the token.
    const accessToken: string = (args["access-token"]?.toString() || "").trim();
    const to: string = args["to"]?.toString() as string;
    const voiceId: number = args["voice-id"] as number;
    const text: string = args["text"]?.toString() as string;

    /*
     * Same SSRF check as the API components. Private targets are allowed,
     * as the device usually sits on the local network.
     */
    try {
      await SSRFProtection.validateWebhookTargetIsSafe(apiUrl, {
        allowPrivateNetworkTargets: true,
      });
    } catch (err) {
      throw options.onError(
        new BadDataException(
          err instanceof Exception
            ? err.message
            : "URL points to an address that is not allowed.",
        ),
      );
    }

    const smsEagleApiUrl: URL = URL.fromString(
      `${apiUrl.replace(/\/+$/, "")}/api/v2/calls/tts_advanced`,
    );

    let apiResult: HTTPResponse<JSONArray> | HTTPErrorResponse | null = null;

    try {
      // https://www.smseagle.eu/docs/apiv2/
      apiResult = await API.post<JSONArray>({
        url: smsEagleApiUrl,
        data: {
          to: [to],
          text: text,
          voice_id: voiceId,
        },
        headers: {
          "access-token": accessToken,
        },
        options: {
          doNotFollowRedirects: true,
        },
      });

      if (apiResult instanceof HTTPErrorResponse) {
        const smsEagleError: string = MakeCall.getErrorMessage(apiResult);
        return Promise.resolve({
          returnValues: {
            error: smsEagleError,
          },
          executePort: errorPort,
        });
      }

      // Check if SMSEagle queued the call (errors can return 200 OK)
      const result: JSONObject | undefined = apiResult.data?.[0] as
        | JSONObject
        | undefined;

      if (!result || result["status"] !== "queued") {
        const smsEagleError: string =
          (result?.["message"] as string) || "SMSEagle API Error.";
        return Promise.resolve({
          returnValues: {
            error: smsEagleError,
          },
          executePort: errorPort,
        });
      }

      return Promise.resolve({
        returnValues: {
          "message-id": result["id"]?.toString(),
        },
        executePort: successPort,
      });
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        const smsEagleError: string = MakeCall.getErrorMessage(err);
        return Promise.resolve({
          returnValues: {
            error: smsEagleError,
          },
          executePort: errorPort,
        });
      }

      throw options.onError(new APIException("Something wrong happened."));
    }
  }
}
