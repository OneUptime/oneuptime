import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import { ApiComponentUtils } from "./Utils";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import APIException from "Common/Types/Exception/ApiException";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ComponentMetadata, { Port } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import APIComponents from "Common/Types/Workflow/Components/API";
import API from "Common/Utils/API";
import logger from "../../../../Utils/Logger";

export default class ApiPost extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = APIComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.ApiPost;
      },
    );

    if (!Component) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(Component);
  }

  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const result: { args: JSONObject; successPort: Port; errorPort: Port } =
      ApiComponentUtils.sanitizeArgs(this.getMetadata(), args, options);

    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    logger.debug("API Post Component is running.");

    const url: URL = args["url"] as URL;
    if (!url) {
      throw options.onError(new BadDataException("URL is required"));
    }

    logger.debug(`URL: ${url}`);

    const requestBody: JSONObject = args["request-body"] as JSONObject;

    logger.debug(`Request Body: ${JSON.stringify(requestBody)}`);

    const requestHeaders: Dictionary<string> = args[
      "request-headers"
    ] as Dictionary<string>;

    logger.debug(`Request Headers: ${JSON.stringify(requestHeaders)}`);

    try {
      apiResult = await API.post(
        args["url"] as URL,
        args["request-body"] as JSONObject,
        args["request-headers"] as Dictionary<string>,
      );

      logger.debug("API Post Component is done.");

      return Promise.resolve({
        returnValues: ApiComponentUtils.getReturnValues(apiResult),
        executePort: result.successPort,
      });
    } catch (err) {
      if (err instanceof HTTPErrorResponse) {
        return Promise.resolve({
          returnValues: ApiComponentUtils.getReturnValues(err),
          executePort: result.successPort,
        });
      }

      if (apiResult) {
        return Promise.resolve({
          returnValues: ApiComponentUtils.getReturnValues(apiResult),
          executePort: result.successPort,
        });
      }

      logger.debug("API Post Component is done with error.");
      logger.debug(err);

      throw options.onError(new APIException("Something wrong happened."));
    }
  }
}
