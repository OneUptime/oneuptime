import { RunOptions } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import { RequestOptions } from "../../../../../Utils/API";
import SSRFProtection from "../../../../Utils/SSRFProtection";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export class ApiComponentUtils {
  /*
   * Every API component sends its request with these. Redirects MUST stay off:
   * sanitizeArgs validates the URL before the request is dispatched, and a
   * validated public host that answers 302 -> http://169.254.169.254/ would
   * otherwise walk the server straight past that check.
   */
  public static readonly requestOptions: RequestOptions = {
    doNotFollowRedirects: true,
  };

  @CaptureSpan()
  public static getReturnValues(
    response: HTTPResponse<JSONObject> | HTTPErrorResponse,
  ): JSONObject {
    if (response instanceof HTTPErrorResponse) {
      return {
        "response-status": response.statusCode,
        "response-body": response.jsonData,
        "response-headers": response.headers,
        error: response.message || "Server Error.",
      };
    }

    return {
      "response-status": response.statusCode,
      "response-body": response.jsonData,
      "response-headers": response.headers,
      error: null,
    };
  }

  @CaptureSpan()
  public static async sanitizeArgs(
    metadata: ComponentMetadata,
    args: JSONObject,
    options: RunOptions,
  ): Promise<{ args: JSONObject; successPort: Port; errorPort: Port }> {
    const successPort: Port | undefined = metadata.outPorts.find((p: Port) => {
      return p.id === "success";
    });

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = metadata.outPorts.find((p: Port) => {
      return p.id === "error";
    });

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    if (args["request-body"] && typeof args["request-body"] === "string") {
      args["request-body"] = JSONFunctions.parse(
        `${args["request-body"] as string}`,
      );
    }

    if (
      args["request-headers"] &&
      typeof args["request-headers"] === "string"
    ) {
      args["request-headers"] = JSONFunctions.parse(
        args["request-headers"] as string,
      );
    }

    /*
     * Headers reach here from a key/value grid that can emit numbers and
     * booleans, from a JSON document someone typed, or from a {{...}}
     * substitution — and every consumer below blind-casts the result to
     * Dictionary<string> before spreading it into the outgoing request. An
     * array or a bare scalar spreads into per-index junk headers rather than
     * failing, so check the shape and flatten the values to strings here.
     */
    if (args["request-headers"]) {
      const headers: JSONValue = args["request-headers"] as JSONValue;

      if (
        typeof headers !== "object" ||
        headers === null ||
        Array.isArray(headers)
      ) {
        throw options.onError(
          new BadDataException(
            "Request headers must be a JSON object of header names and values.",
          ),
        );
      }

      const stringifiedHeaders: JSONObject = {};

      for (const headerName of Object.keys(headers as JSONObject)) {
        const headerValue: JSONValue = (headers as JSONObject)[
          headerName
        ] as JSONValue;

        if (headerValue === null || headerValue === undefined) {
          continue;
        }

        stringifiedHeaders[headerName] =
          typeof headerValue === "object"
            ? JSON.stringify(headerValue)
            : String(headerValue);
      }

      args["request-headers"] = stringifiedHeaders;
    }

    if (!args["url"]) {
      throw options.onError(new BadDataException("URL not found"));
    }

    if (args["url"] && typeof args["url"] !== "string") {
      throw options.onError(new BadDataException("URL is not type of string"));
    }

    /*
     * The URL is authored by whoever built the workflow - i.e. any member of
     * any project - and the request goes out from the server, which sits
     * inside the cluster and next to the cloud metadata endpoint. Without this
     * check the API components are an authenticated request proxy into the
     * private network: GET http://169.254.169.254/latest/meta-data/iam/... and
     * the credentials come back in the component's "response-body" return
     * value, in plain sight in the workflow log. Resolve and blocklist the
     * target the same way outbound webhooks already do.
     *
     * Validate the RAW string, before URL.fromString - that parser defaults an
     * unrecognized scheme to https, so "file:///etc/passwd" would reach the
     * check already rewritten as host "file".
     *
     * A self-hosted install may legitimately point a workflow at an internal
     * service (issue #3424), so this URL is eligible for the instance's
     * private-network exception: a workflow is authored by a member of the
     * project it runs in, not by a passing visitor. Whether that eligibility
     * grants anything is decided by the instance configuration, which is off
     * on every SaaS deployment and off by default everywhere else.
     */
    try {
      await SSRFProtection.validateWebhookTargetIsSafe(args["url"] as string, {
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

    args["url"] = URL.fromString(args["url"] as string);

    return { args, successPort, errorPort };
  }
}
