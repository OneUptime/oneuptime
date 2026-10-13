import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import SMSEagleComponents from "../../../../../Types/Workflow/Components/SMSEagle";
import API from "../../../../../Utils/API";
import SSRFProtection from "../../../../Utils/SSRFProtection";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { SMSEAGLE_MAX_STEP_TIME_IN_MS, SMSEagleComponentUtils } from "./Utils";

export default class SendSms extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = SMSEagleComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.SMSEagleSendSms;
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

    if (!args["text"]) {
      throw options.onError(new BadDataException("SMS message not found"));
    }

    const apiUrl: string = (args["api-url"]?.toString() || "").trim();
    // A token pasted or stored with a trailing newline is still the token.
    const accessToken: string = (args["access-token"]?.toString() || "").trim();
    const to: string = args["to"]?.toString() as string;
    const text: string = args["text"]?.toString() as string;

    /*
     * Same SSRF check as the API components. Private targets are allowed
     * only where the instance permits them.
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
      `${apiUrl.replace(/\/+$/, "")}/api/v2/messages/sms`,
    );

    let apiResult: HTTPResponse<JSONArray> | HTTPErrorResponse | null = null;
    let timeoutInMs: number = SMSEAGLE_MAX_STEP_TIME_IN_MS;

    try {
      timeoutInMs = SMSEagleComponentUtils.getTimeoutInMs(options);

      // https://www.smseagle.eu/docs/apiv2/
      apiResult = await API.post<JSONArray>({
        url: smsEagleApiUrl,
        data: {
          to: [to],
          text: text,
        },
        headers: {
          "access-token": accessToken,
        },
        options: {
          doNotFollowRedirects: true,
          timeout: timeoutInMs,
        },
      });

      if (apiResult instanceof HTTPErrorResponse) {
        const smsEagleError: string =
          SMSEagleComponentUtils.getErrorMessage(apiResult);
        return Promise.resolve({
          returnValues: {
            error: smsEagleError,
          },
          executePort: errorPort,
        });
      }

      // Anything other than "queued" means SMSEagle did not accept it
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
        const smsEagleError: string =
          SMSEagleComponentUtils.getErrorMessage(err);
        return Promise.resolve({
          returnValues: {
            error: smsEagleError,
          },
          executePort: errorPort,
        });
      }

      if (SMSEagleComponentUtils.isTimeoutError(err)) {
        return Promise.resolve({
          returnValues: {
            error: `SMSEagle did not answer within ${Math.max(1, Math.round(timeoutInMs / 1000))} seconds, so the SMS may not have been sent.`,
          },
          executePort: errorPort,
        });
      }

      const smsEagleError: string =
        err instanceof Exception
          ? err.message
          : "The request could not be sent to SMSEagle.";
      return Promise.resolve({
        returnValues: {
          error: smsEagleError,
        },
        executePort: errorPort,
      });
    }
  }
}
