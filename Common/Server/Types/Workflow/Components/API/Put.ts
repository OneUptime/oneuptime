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
import API from "../../../../../Utils/API";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class ApiPut extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = APIComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.ApiPut;
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
    const result: { args: JSONObject; successPort: Port; errorPort: Port } =
      ApiComponentUtils.sanitizeArgs(this.getMetadata(), args, options);

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    try {
      apiResult = await API.put(
        args["url"] as URL,
        args["request-body"] as JSONObject,
        args["request-headers"] as Dictionary<string>,
      );

      return Promise.resolve({
        returnValues: ApiComponentUtils.getReturnValues(apiResult),
        executePort: result.successPort,
      });
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        return Promise.resolve({
          returnValues: ApiComponentUtils.getReturnValues(err),
          executePort: result.errorPort,
        });
      }

      if (apiResult) {
        return Promise.resolve({
          returnValues: ApiComponentUtils.getReturnValues(apiResult),
          executePort: result.errorPort,
        });
      }

      return Promise.resolve({
        returnValues: {
          errorMessage: (err as Error).message || "Unknown error",
        },
        executePort: result.errorPort,
      });
    }
  }
}
