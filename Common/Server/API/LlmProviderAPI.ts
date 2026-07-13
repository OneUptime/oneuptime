import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import LlmProviderService, {
  Service as LlmProviderServiceType,
} from "../Services/LlmProviderService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LLMService, { LLMProviderConfig } from "../Utils/LLM/LLMService";
import LlmType from "../../Types/LLM/LlmType";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";

export default class LlmProviderAPI extends BaseAPI<
  LlmProvider,
  LlmProviderServiceType
> {
  public constructor() {
    super(LlmProvider, LlmProviderService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-llms`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const llmProviders: Array<LlmProvider> =
            await LlmProviderService.findBy({
              query: {
                isGlobalLlm: true,
              },
              select: {
                name: true,
                description: true,
                costPerMillionTokensInUSDCents: true,
              },
              props: {
                isRoot: true,
              },
              skip: 0,
              limit: LIMIT_MAX,
            });

          return Response.sendEntityArrayResponse(
            req,
            res,
            llmProviders,
            new PositiveNumber(llmProviders.length),
            LlmProvider,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Test an LLM Provider configuration by sending a small prompt to the
     * provider and confirming it responds. Lets users verify their API key,
     * model name, and base URL are correct right after adding a provider.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = req.body;

          if (!body["llmProviderId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("llmProviderId is required"),
            );
          }

          const llmProviderId: ObjectID = new ObjectID(
            body["llmProviderId"] as string,
          );

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * Access check: read the provider with the requesting user's
           * permissions so the query is scoped to their project. If they
           * cannot read it (wrong project / no access), it comes back null.
           */
          const accessibleProvider: LlmProvider | null =
            await LlmProviderService.findOneById({
              id: llmProviderId,
              select: {
                _id: true,
                projectId: true,
                isGlobalLlm: true,
              },
              props: props,
            });

          if (!accessibleProvider) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "LLM Provider not found, or you do not have access to it.",
              ),
            );
          }

          /*
           * Global LLM providers are shared across all projects and their keys
           * are managed by platform admins, so only master admins may test them
           * (e.g. from the Admin Dashboard). Project providers are already
           * gated by the access-scoped read above.
           */
          const isGlobalProvider: boolean =
            accessibleProvider.isGlobalLlm === true ||
            !accessibleProvider.projectId;

          if (isGlobalProvider && !props.isMasterAdmin) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Only administrators can test global LLM providers.",
              ),
            );
          }

          /*
           * Load the full config (including the decrypted API key) as root to
           * actually run the test. The access check above already confirmed
           * the caller is allowed to use this provider.
           */
          const provider: LlmProvider | null =
            await LlmProviderService.findOneById({
              id: llmProviderId,
              select: {
                _id: true,
                llmType: true,
                apiKey: true,
                baseUrl: true,
                modelName: true,
                additionalParams: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!provider || !provider.llmType) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "LLM Provider configuration is incomplete. Please set the provider type.",
              ),
            );
          }

          const llmProviderConfig: LLMProviderConfig = {
            llmType: provider.llmType as LlmType,
            ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
            ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
            ...(provider.modelName ? { modelName: provider.modelName } : {}),
          };

          try {
            await LLMService.getCompletion({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a connection test. Reply with a single short word.",
                },
                {
                  role: "user",
                  content: "Reply with the word: OK",
                },
              ],
              temperature: 0,
              maxTokens: 16,
              llmProviderConfig: llmProviderConfig,
              ...(provider.additionalParams
                ? { additionalParams: provider.additionalParams }
                : {}),
            });
          } catch (err) {
            logger.error(err);

            /*
             * Surface the provider's own error (bad key, unknown model,
             * unreachable base URL, etc.) so the user can fix their config.
             */
            const providerMessage: string =
              err instanceof Exception
                ? err.message
                : "Failed to connect to the LLM provider. Please verify the API key, model name, and base URL.";

            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `LLM Provider test failed: ${providerMessage.substring(0, 1000)}`,
              ),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message:
              "Connection successful. The LLM provider responded to a test prompt.",
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
