import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import CopilotPullRequestService, {
  Service as CopilotPullRequestServiceType,
} from "../Services/CopilotPullRequestService";
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
import CopilotCodeRepositoryService from "../Services/CopilotCodeRepositoryService";
import CodeRepositoryAuthorization from "../Middleware/CodeRepositoryAuthorization";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";

export default class CopilotPullRequestAPI extends BaseAPI<
  CopilotPullRequest,
  CopilotPullRequestServiceType
> {
  public constructor() {
    super(CopilotPullRequest, CopilotPullRequestService);

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/get-pending-pull-requests/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const codeRepository: CopilotCodeRepository | null =
            await CopilotCodeRepositoryService.findOneBy({
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

          const copilotPullRequests: Array<CopilotPullRequest> =
            await CopilotPullRequestService.findBy({
              query: {
                codeRepositoryId: codeRepository.id!,
                copilotPullRequestStatus: PullRequestState.Open, // only get pending pull requests
              },
              select: {
                _id: true,
                codeRepositoryId: true,
                projectId: true,
                copilotPullRequestStatus: true,
                pullRequestId: true,
                isSetupPullRequest: true,
                serviceCatalogId: true,
                serviceRepositoryId: true,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            copilotPullRequests: CopilotPullRequest.toJSONArray(
              copilotPullRequests,
              CopilotPullRequest,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/add-pull-request/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const codeRepository: CopilotCodeRepository | null =
            await CopilotCodeRepositoryService.findOneBy({
              query: {
                secretToken: new ObjectID(secretkey),
              },
              select: {
                _id: true,
                projectId: true,
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

          if (!req.body["copilotPullRequest"]) {
            throw new BadDataException("Copilot pull request is required");
          }

          const copilotPullRequest: CopilotPullRequest =
            CopilotPullRequest.fromJSON(
              req.body["copilotPullRequest"],
              CopilotPullRequest,
            ) as CopilotPullRequest;

          copilotPullRequest.codeRepositoryId = codeRepository.id!;
          copilotPullRequest.projectId = codeRepository.projectId!;
          copilotPullRequest.copilotPullRequestStatus = PullRequestState.Open;

          const createdPullRequest: CopilotPullRequest =
            await CopilotPullRequestService.create({
              data: copilotPullRequest,
              props: {
                isRoot: true,
              },
            });

          return Response.sendEntityResponse(
            req,
            res,
            createdPullRequest,
            CopilotPullRequest,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/update-pull-request-status/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const codeRepository: CopilotCodeRepository | null =
            await CopilotCodeRepositoryService.findOneBy({
              query: {
                secretToken: new ObjectID(secretkey),
              },
              select: {
                _id: true,
                projectId: true,
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

          if (!req.body["copilotPullRequestId"]) {
            throw new BadDataException("Copilot pull request is required");
          }

          // check copilotPullRequestStatus

          if (!req.body["copilotPullRequestStatus"]) {
            throw new BadDataException(
              "Copilot pull request status is required",
            );
          }

          const copilotPullRequestId: ObjectID = new ObjectID(
            req.body["copilotPullRequestId"],
          );

          const copilotPullRequest: CopilotPullRequest | null =
            await CopilotPullRequestService.findOneById({
              id: copilotPullRequestId,
              select: {
                copilotPullRequestStatus: true,
                pullRequestId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!copilotPullRequest) {
            throw new BadDataException("Copilot pull request not found");
          }

          await CopilotPullRequestService.updateOneById({
            id: copilotPullRequestId,
            data: {
              copilotPullRequestStatus: req.body["copilotPullRequestStatus"],
            },
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
