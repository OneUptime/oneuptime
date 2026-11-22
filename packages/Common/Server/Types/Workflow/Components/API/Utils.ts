import { RunOptions } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import {
  ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID,
  CA_CERTIFICATE_ARGUMENT_ID,
} from "../../../../../Types/Workflow/Components/ApiCertificates";
import {
  CaCertificatePemProblem,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HttpStepCertificateSettings,
  getHttpStepCertificateFailureMessage,
  getHttpStepCertificateSettings,
} from "../../../../../Types/Runbook/HttpStepCertificates";
import { getRequestErrorCode } from "../../../../../Utils/RequestErrorCode";
import { TargetTlsOptions } from "../../../../Utils/OutboundProxyAgents";
import { getCaCertificatePemProblem } from "../../../../Utils/Runbook/HttpStepCaCertificate";
import SafeWebhookRequest, {
  WebhookTarget,
} from "../../../../Utils/SafeWebhookRequest";
import { WebhookTargetValidationOptions } from "../../../../Utils/SSRFProtection";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

/*
 * A workflow is authored by a member of the project it runs in, not by a
 * passing visitor, so its URLs are eligible for the instance's
 * private-network exception (issue #3424). Whether that eligibility grants
 * anything is decided by the instance configuration, which is off on every
 * SaaS deployment and off by default everywhere else.
 */
export const API_COMPONENT_TARGET_VALIDATION: WebhookTargetValidationOptions = {
  allowPrivateNetworkTargets: true,
};

/*
 * The most of an answer an API step reads: 10 MB, as the Custom JavaScript
 * step's HTTP requests do (MAX_HTTP_RESPONSE_BYTES in VM/VMRunner). A step
 * hands its answer to the rest of the workflow as Response Body, so the cap
 * is generous - a page of a large JSON list fits - but it is there: a
 * workflow pointed at an endpoint that streams forever used to fill the
 * workflow worker's memory, and on OneUptime Cloud every project shares
 * that worker (issue #8875). A larger answer takes the error port, unread,
 * with Error saying so (WebhookAnswerTooLargeException). The workflow
 * components docs say the limit.
 */
export const API_COMPONENT_MAX_RESPONSE_BYTES: number = 10 * 1024 * 1024;

// What sanitizeArgs hands a step: its arguments, its ports, and where it may send.
export interface SanitizedApiArgs {
  args: JSONObject;
  successPort: Port;
  errorPort: Port;
  // The step's URL as its check approved it: the only place the request may go.
  target: WebhookTarget;
  /*
   * How the step checks the server's certificate: as every request does, by
   * its CA certificate alone, or not at all (Types/Workflow/Components/
   * ApiCertificates, #10440).
   */
  certificates: HttpStepCertificateSettings;
}

export class ApiComponentUtils {
  /*
   * Sends a step's request - its body and headers as sanitizeArgs left them -
   * to the address sanitizeArgs approved, and nowhere else
   * (SafeWebhookRequest). Redirects stay off: a validated public host that
   * answers 302 -> http://169.254.169.254/ would otherwise walk the server
   * straight past the check, and a name that resolves somewhere else by now
   * is never dialled. At most API_COMPONENT_MAX_RESPONSE_BYTES of the
   * answer is read.
   */
  public static async send(data: {
    method: HTTPMethod;
    sanitized: SanitizedApiArgs;
    // Whether the step sends a body: API Get By ID never does.
    withBody?: boolean | undefined;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    const args: JSONObject = data.sanitized.args;

    return await SafeWebhookRequest.send<JSONObject>(data.sanitized.target, {
      method: data.method,
      data:
        data.withBody === false
          ? undefined
          : (args["request-body"] as JSONObject | undefined) || undefined,
      headers: args["request-headers"] as Dictionary<string> | undefined,
      maxContentLength: API_COMPONENT_MAX_RESPONSE_BYTES,
      // This request's alone: never the proxy's connection, nor another's.
      tls: ApiComponentUtils.getTlsOptions(data.sanitized.certificates),
    });
  }

  /*
   * The step's certificate settings as the request's TLS options: none,
   * which checks the server's certificate as every request does; no check
   * at all; or its CA certificate alone, the host name and dates still
   * checked.
   */
  public static getTlsOptions(
    certificates: HttpStepCertificateSettings,
  ): TargetTlsOptions | undefined {
    if (certificates.skipsCertificateChecks) {
      return { rejectUnauthorized: false };
    }

    if (certificates.caCertificate) {
      return { ca: certificates.caCertificate };
    }

    return undefined;
  }

  /*
   * The Error a step returns when its request failed: a certificate the
   * step refused says why and which of its settings would let it through,
   * the safer first, in the words a Runbook HTTP step uses
   * (getHttpStepCertificateFailureMessage); anything else says what it did.
   */
  public static describeFailure(
    error: unknown,
    sanitized: SanitizedApiArgs,
  ): string {
    const certificateMessage: string | null =
      getHttpStepCertificateFailureMessage({
        code: getRequestErrorCode(error),
        host: sanitized.target.url.hostname,
        settings: sanitized.certificates,
      });

    if (certificateMessage) {
      return certificateMessage;
    }

    return error instanceof Error && error.message
      ? error.message
      : "Unknown error";
  }

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
  ): Promise<SanitizedApiArgs> {
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
     * private-network exception (API_COMPONENT_TARGET_VALIDATION).
     *
     * The check answers the addresses it approved, and send() dials one of
     * those and no other: checking a name and then letting the HTTP client
     * look it up again would leave the window a rebinding DNS server needs.
     */
    let target: WebhookTarget;

    try {
      target = await SafeWebhookRequest.resolveTarget(
        args["url"] as string,
        API_COMPONENT_TARGET_VALIDATION,
      );
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

    /*
     * How the step checks the server's certificate (#10440). A CA
     * certificate that is not one is refused before anything is sent: Node
     * takes text that is not a certificate without a word, and the step would
     * then fail on the certificate it was meant to trust. Its value is the
     * one the workflow filled in, so a reference left in it is text, not a
     * certificate.
     */
    const certificates: HttpStepCertificateSettings =
      getHttpStepCertificateSettings({
        allowSelfSignedCertificates:
          args[ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID] === true,
        ...(typeof args[CA_CERTIFICATE_ARGUMENT_ID] === "string"
          ? { caCertificate: args[CA_CERTIFICATE_ARGUMENT_ID] as string }
          : {}),
      });

    if (certificates.caCertificate) {
      const problem: CaCertificatePemProblem | null =
        getCaCertificatePemProblem(certificates.caCertificate);

      if (problem) {
        throw options.onError(
          new BadDataException(
            HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem],
          ),
        );
      }
    }

    return { args, successPort, errorPort, target, certificates };
  }
}
