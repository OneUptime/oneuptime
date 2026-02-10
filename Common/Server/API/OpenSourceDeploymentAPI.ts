import OpenSourceDeployment from "../../Models/DatabaseModels/OpenSourceDeployment";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import API from "../../Utils/API";
import OpenSourceDeploymentService, {
  Service as OpenSourceDeploymentServiceType,
} from "../Services/OpenSourceDeploymentService";
import { OpenSourceDeploymentWebhookUrl } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
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
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          const deployment: OpenSourceDeployment = new OpenSourceDeployment();

          deployment.email = (body["email"] as string) || "";
          deployment.name = (body["name"] as string) || "";
          deployment.companyName = (body["companyName"] as string) || "";
          deployment.companyPhoneNumber =
            (body["companyPhoneNumber"] as string) || "";
          deployment.oneuptimeVersion =
            (body["oneuptimeVersion"] as string) || "unknown";
          deployment.instanceUrl = (body["instanceUrl"] as string) || "";

          await OpenSourceDeploymentService.create({
            data: deployment,
            props: {
              isRoot: true,
            },
          });

          if (OpenSourceDeploymentWebhookUrl) {
            API.post({
              url: URL.fromString(OpenSourceDeploymentWebhookUrl),
              data: {
                email: deployment.email?.toString() || "",
                name: deployment.name?.toString() || "",
                companyName: deployment.companyName?.toString() || "",
                companyPhoneNumber:
                  deployment.companyPhoneNumber?.toString() || "",
                oneuptimeVersion: deployment.oneuptimeVersion?.toString() || "",
                instanceUrl: deployment.instanceUrl?.toString() || "",
              },
            }).catch((err: Error) => {
              logger.error(err);
            });
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
