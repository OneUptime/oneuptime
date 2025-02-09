import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import CopilotActionService, {
  Service as CopilotActionServiceType,
} from "../Services/CopilotActionService";
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
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import CopilotCodeRepositoryService from "../Services/CopilotCodeRepositoryService";
import CodeRepositoryAuthorization from "../Middleware/CodeRepositoryAuthorization";
import CopilotActionStatus from "../../Types/Copilot/CopilotActionStatus";
import CopilotActionTypePriority from "../../Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionTypePriorityService from "../Services/CopilotActionTypePriorityService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import JSONFunctions from "../../Types/JSONFunctions";
import CopilotActionType from "../../Types/Copilot/CopilotActionType";
import { JSONObject } from "../../Types/JSON";
import OneUptimeDate from "../../Types/Date";

export default class CopilotActionAPI extends BaseAPI<
  CopilotAction,
  CopilotActionServiceType
> {
  public constructor() {
    super(CopilotAction, CopilotActionService);

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/copilot-action-types-by-priority/:secretkey`,
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

          const copilotActionTypes: Array<CopilotActionTypePriority> =
            await CopilotActionTypePriorityService.findBy({
              query: {
                codeRepositoryId: codeRepository.id!,
              },
              select: {
                _id: true,
                actionType: true,
                priority: true,
              },
              skip: 0,
              sort: {
                priority: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            actionTypes: CopilotActionTypePriority.toJSONArray(
              copilotActionTypes,
              CopilotActionTypePriority,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/copilot-actions-in-queue/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const serviceCatalogId: string = req.body["serviceCatalogId"]!;

          if (!serviceCatalogId) {
            throw new BadDataException("Service catalog id is required");
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

          const copilotActions: Array<CopilotAction> =
            await CopilotActionService.findBy({
              query: {
                codeRepositoryId: codeRepository.id!,
                serviceCatalogId: new ObjectID(serviceCatalogId),
                copilotActionStatus: CopilotActionStatus.IN_QUEUE,
              },
              select: {
                _id: true,
                codeRepositoryId: true,
                serviceCatalogId: true,
                copilotActionStatus: true,
                copilotActionType: true,
                copilotActionProp: true,
                createdAt: true,
                copilotPullRequest: {
                  _id: true,
                  pullRequestId: true,
                  copilotPullRequestStatus: true,
                },
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            copilotActions: CopilotAction.toJSONArray(
              copilotActions,
              CopilotAction,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/get-copilot-action/:secretkey`,
      CodeRepositoryAuthorization.isAuthorizedRepository,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const secretkey: string = req.params["secretkey"]!;

          if (!secretkey) {
            throw new BadDataException("Secret key is required");
          }

          const serviceCatalogId: string = req.body["serviceCatalogId"]!;

          if (!serviceCatalogId) {
            throw new BadDataException("Service catalog id is required");
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

          const actionType: CopilotActionType = req.body["actionType"]!;

          if (!actionType) {
            throw new BadDataException("Action type is required");
          }

          const actionProps: JSONObject = req.body["actionProps"]!;

          const copilotAction: CopilotAction | null =
            await CopilotActionService.findOneBy({
              query: {
                codeRepositoryId: codeRepository.id!,
                serviceCatalogId: new ObjectID(serviceCatalogId),
                copilotActionType: actionType,
                copilotActionProp: actionProps as any,
              },
              select: {
                _id: true,
                codeRepositoryId: true,
                serviceCatalogId: true,
                copilotActionStatus: true,
                copilotActionType: true,
                createdAt: true,
                copilotPullRequest: {
                  _id: true,
                  pullRequestId: true,
                  copilotPullRequestStatus: true,
                },
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            copilotAction: copilotAction
              ? CopilotAction.toJSONObject(copilotAction, CopilotAction)
              : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/create-copilot-action/:secretkey`,
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

          const copilotAction: CopilotAction = CopilotAction.fromJSON(
            req.body["copilotAction"],
            CopilotAction,
          ) as CopilotAction;

          copilotAction.codeRepositoryId = codeRepository.id!;
          copilotAction.projectId = codeRepository.projectId!;
          copilotAction.copilotActionStatus = CopilotActionStatus.IN_QUEUE;

          const createdAction: CopilotAction =
            await CopilotActionService.create({
              data: copilotAction,
              props: {
                isRoot: true,
              },
            });

          return Response.sendEntityResponse(
            req,
            res,
            createdAction,
            CopilotAction,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/update-copilot-action/:secretkey`,
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

          req.body = JSONFunctions.deserialize(req.body);

          const {
            actionStatus,
            pullRequestId,
            commitHash,
            statusMessage,
            logs,
            actionId,
          }: {
            actionStatus: CopilotActionStatus;
            pullRequestId?: ObjectID | undefined;
            commitHash?: string | undefined;
            statusMessage?: string | undefined;
            logs?: Array<string> | undefined;
            actionId: ObjectID;
          } = req.body;

          const exisingAction: CopilotAction | null =
            await CopilotActionService.findOneBy({
              query: {
                _id: actionId,
                codeRepositoryId: codeRepository.id!,
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!exisingAction) {
            throw new BadDataException("Action not found");
          }

          await CopilotActionService.updateOneBy({
            query: {
              _id: actionId,
              codeRepositoryId: codeRepository.id!,
            },
            data: {
              copilotActionStatus: actionStatus!,
              copilotPullRequestId: pullRequestId!,
              commitHash: commitHash!,
              statusMessage: statusMessage!,
              statusChangedAt: OneUptimeDate.getCurrentDate(),
              logs: logs?.join("\n") || "",
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
