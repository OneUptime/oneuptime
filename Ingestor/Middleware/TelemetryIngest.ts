import { ProbeExpressRequest } from "../Types/Request";
import DiskSize from "Common/Types/DiskSize";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import TelemetryServiceService from "CommonServer/Services/TelemetryServiceService";
import TelemetryUsageBillingService from "CommonServer/Services/TelemetryUsageBillingService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import TelemetryService from "Model/Models/TelemetryService";
import { DEFAULT_RETENTION_IN_DAYS } from "Model/Models/TelemetryUsageBilling";

export interface TelemetryRequest extends ExpressRequest {
  serviceId: ObjectID; // Service ID
  serviceName: string; // Service Name
  projectId: ObjectID; // Project ID
  dataRententionInDays: number; // how long the data should be retained.
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

      const serviceTokenInHeader: string | undefined = req.headers[
        "x-oneuptime-service-token"
      ] as string | undefined;

      if (!serviceTokenInHeader) {
        throw new BadRequestException(
          "Missing header: x-oneuptime-service-token",
        );
      }

      // size of req.body in bytes.
      const sizeInBytes: number = Buffer.byteLength(JSON.stringify(req.body));

      const sizeToGb: number = DiskSize.byteSizeToGB(sizeInBytes);

      // load from the database and set the cache.
      const service: TelemetryService | null =
        await TelemetryServiceService.findOneBy({
          query: {
            telemetryServiceToken: new ObjectID(serviceTokenInHeader as string),
          },
          select: {
            _id: true,
            projectId: true,
            retainTelemetryDataForDays: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!service) {
        throw new BadRequestException(
          "Invalid service token: " + serviceTokenInHeader,
        );
      }

      (req as TelemetryRequest).serviceId = service.id as ObjectID;
      (req as TelemetryRequest).projectId = service.projectId as ObjectID;
      (req as TelemetryRequest).serviceName = service.name as string;
      (req as TelemetryRequest).dataRententionInDays =
        service.retainTelemetryDataForDays || DEFAULT_RETENTION_IN_DAYS;

      (req as TelemetryRequest).serviceId = service.id as ObjectID;
      (req as TelemetryRequest).projectId = service.projectId as ObjectID;

      // report to Usage Service.
      TelemetryUsageBillingService.updateUsageBilling({
        projectId: (req as TelemetryRequest).projectId,
        productType: (req as TelemetryRequest).productType,
        dataIngestedInGB: sizeToGb,
        telemetryServiceId: (req as TelemetryRequest).serviceId,
        retentionInDays: (req as TelemetryRequest).dataRententionInDays,
      }).catch((err: Error) => {
        logger.error("Failed to update usage billing for OTel");
        logger.error(err);
      });

      next();
    } catch (err) {
      return next(err);
    }
  }
}
