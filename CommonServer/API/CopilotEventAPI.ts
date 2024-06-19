import CodeRepository from "Model/Models/CodeRepository";
import CopilotEventService, {
  Service as CopilotEventServiceType,
} from "../Services/CopilotEventService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import CopilotEvent from "Model/Models/CopilotEvent";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import CodeRepositoryAuthorization from "../Middleware/CodeRepositoryAuthorization";

export default class CopilotEventAPI extends BaseAPI<
  CopilotEvent,
  CopilotEventServiceType
> {
  public constructor() {
    super(CopilotEvent, CopilotEventService);

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/copilot-events-by-file/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const filePath: string = req.body["filePath"]!;

          if (!filePath) {
            throw new BadDataException("File path is required");
          }

          const serviceCatalogId: string = req.body["serviceCatalogId"]!;

          if (!serviceCatalogId) {
            throw new BadDataException("Service catalog id is required");
          }

          const codeRepository: CodeRepository | null =
            await CodeRepositoryService.findOneBy({
              query: {
                secretToken: new ObjectID(secretkey),
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!codeRepository) {
            throw new BadDataException(
              "Code repository not found. Secret key is invalid.",
            );
          }

          const copilotEvents: Array<CopilotEvent> =
            await CopilotEventService.findBy({
              query: {
                codeRepositoryId: codeRepository.id!,
                filePath: filePath,
                serviceCatalogId: new ObjectID(serviceCatalogId),
              },
              select: {
                _id: true,
                codeRepositoryId: true,
                serviceCatalogId: true,
                filePath: true,
                copilotEventStatus: true,
                copilotEventType: true,
                createdAt: true,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            copilotEvents: CopilotEvent.toJSONArray(
              copilotEvents,
              CopilotEvent,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
