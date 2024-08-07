import { ProbeExpressRequest } from "../Types/Request";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";

export interface TelemetryRequest extends ExpressRequest {
  projectId: ObjectID; // Project ID
  productType: ProductType; // what is the product type of the request - logs, metrics or traces.
}

export default class TelemetryIngest {
  public static async isAuthorizedServiceMiddleware(
    req: ProbeExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      // check header.

      let oneuptimeToken: string | undefined = req.headers[
        "x-oneuptime-token"
      ] as string | undefined;

      // if x-oneuptime-service-token header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-service-token"] as
          | string
          | undefined;
      }

      if (!oneuptimeToken) {
        throw new BadRequestException("Missing header: x-oneuptime-token");
      }

      let projectId: ObjectID | undefined = undefined;

      const token: TelemetryIngestionKey | null =
        await TelemetryIngestionKeyService.findOneBy({
          query: {
            secretKey: new ObjectID(oneuptimeToken?.toString() || ""),
          },
          select: {
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!token) {
        throw new BadRequestException(
          "Invalid service token: " + oneuptimeToken,
        );
      }

      projectId = token.projectId as ObjectID;

      if (!projectId) {
        throw new BadRequestException(
          "Project ID not found for service token: " + oneuptimeToken,
        );
      }

      (req as TelemetryRequest).projectId = projectId as ObjectID;

      next();
    } catch (err) {
      return next(err);
    }
  }
}
