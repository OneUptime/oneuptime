import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import { ApiComponentUtils, SanitizedApiArgs } from "./Utils";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import APIComponents from "../../../../../Types/Workflow/Components/API";
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
    const result: SanitizedApiArgs = await ApiComponentUtils.sanitizeArgs(
      this.getMetadata(),
      args,
      options,
    );

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    try {
      apiResult = await ApiComponentUtils.send({
        method: HTTPMethod.PUT,
        sanitized: result,
      });

      /*
       * On the server API resolves with an HTTPErrorResponse instead of
       * throwing (only the UI subclass throws), so the catch below never sees
       * an HTTP error - a 4xx/5xx used to take the success port and log
       * "Success" at the customer.
       */
      if (apiResult instanceof HTTPErrorResponse) {
        return Promise.resolve({
          returnValues: ApiComponentUtils.getReturnValues(apiResult),
          executePort: result.errorPort,
        });
      }

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
          // A refused certificate says which setting would let it through.
          error: ApiComponentUtils.describeFailure(err, result),
        },
        executePort: result.errorPort,
      });
    }
  }
}
