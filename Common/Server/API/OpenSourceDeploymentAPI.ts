import OpenSourceDeployment from "../../Models/DatabaseModels/OpenSourceDeployment";
import { JSONObject } from "../../Types/JSON";
import OpenSourceDeploymentService, {
  Service as OpenSourceDeploymentServiceType,
} from "../Services/OpenSourceDeploymentService";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";

export default class OpenSourceDeploymentAPI extends BaseAPI<
  OpenSourceDeployment,
  OpenSourceDeploymentServiceType
> {
  public constructor() {
    super(OpenSourceDeployment, OpenSourceDeploymentService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/register`,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => {
        try {
          const body: JSONObject = req.body;

          const deployment: OpenSourceDeployment =
            new OpenSourceDeployment();

          deployment.email = (body["email"] as string) || "";
          deployment.name = (body["name"] as string) || "";
          deployment.companyName =
            (body["companyName"] as string) || undefined;
          deployment.companyPhoneNumber =
            (body["companyPhoneNumber"] as string) || undefined;
          deployment.version = (body["version"] as string) || "unknown";
          deployment.instanceUrl =
            (body["instanceUrl"] as string) || undefined;

          await OpenSourceDeploymentService.create({
            data: deployment,
            props: {
              isRoot: true,
            },
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
