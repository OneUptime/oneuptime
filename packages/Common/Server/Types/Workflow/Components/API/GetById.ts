import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import { ApiComponentUtils } from "./Utils";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import APIComponents from "../../../../../Types/Workflow/Components/API";
import {
  ApiGetByIdUrl,
  buildApiGetByIdUrl,
} from "../../../../../Types/Workflow/Components/ApiGetById";
import API from "../../../../../Utils/API";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

/*
 * API Get By ID (Types/Workflow/Components/ApiGetById): the ID goes into the
 * URL only when it is a plain ID, and then the request is exactly API Get's
 * - the same address rules, no redirects, the same return values and
 * outputs.
 */
export default class ApiGetById extends ComponentCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined = APIComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.ApiGetById;
      },
    );

    if (!component) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (port: Port) => {
        return port.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    // The ID is checked, and placed, before anything else looks at the URL.
    const placed: ApiGetByIdUrl = buildApiGetByIdUrl({
      url: args["url"],
      id: args["id"],
    });

    if (placed.error !== undefined) {
      options.log(placed.error);

      return {
        returnValues: { error: placed.error },
        executePort: errorPort,
        executePortReason: placed.error,
      };
    }

    args["url"] = placed.url;

    const result: { args: JSONObject; successPort: Port; errorPort: Port } =
      await ApiComponentUtils.sanitizeArgs(this.getMetadata(), args, options);

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    try {
      apiResult = await API.get({
        url: result.args["url"] as unknown as URL,
        headers: result.args["request-headers"] as Dictionary<string>,
        options: ApiComponentUtils.requestOptions,
      });

      // On the server API resolves with an HTTPErrorResponse rather than throwing.
      if (apiResult instanceof HTTPErrorResponse) {
        return {
          returnValues: ApiComponentUtils.getReturnValues(apiResult),
          executePort: result.errorPort,
        };
      }

      return {
        returnValues: ApiComponentUtils.getReturnValues(apiResult),
        executePort: result.successPort,
      };
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        return {
          returnValues: ApiComponentUtils.getReturnValues(err),
          executePort: result.errorPort,
        };
      }

      if (apiResult) {
        return {
          returnValues: ApiComponentUtils.getReturnValues(apiResult),
          executePort: result.errorPort,
        };
      }

      return {
        returnValues: {
          error: (err as Error).message || "Unknown error",
        },
        executePort: result.errorPort,
      };
    }
  }
}
