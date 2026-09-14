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
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
  LLMToolCall,
  LLMToolDefinition,
} from "../Utils/LLM/LLMService";
import LlmType from "../../Types/LLM/LlmType";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";

/*
 * The smallest possible tool: no arguments, one obvious reason to call it.
 * A provider that can call tools at all can call this one.
 */
const CONNECTION_TEST_TOOL: LLMToolDefinition = {
  name: "connection_test_ping",
  description:
    "Call this tool to confirm that tool calling works. Takes no arguments.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

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

          const runTestCompletion: (
            withTools: boolean,
          ) => Promise<LLMCompletionResponse> = (
            withTools: boolean,
          ): Promise<LLMCompletionResponse> => {
            return LLMService.getCompletion({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a connection test. Reply with a single short word.",
                },
                {
                  role: "user",
                  content: withTools
                    ? `Call the ${CONNECTION_TEST_TOOL.name} tool, then reply with the word: OK`
                    : "Reply with the word: OK",
                },
              ],
              ...(withTools ? { tools: [CONNECTION_TEST_TOOL] } : {}),
              temperature: 0,
              /*
               * Wildly generous for a one-word reply, on purpose. The verdict
               * this route now reports depends on the model getting far
               * enough to emit a tool call, and on a reasoning model
               * (gpt-5, o-series) the thinking tokens are billed against this
               * same cap — at a small cap those models routinely stop at
               * "length" with nothing emitted, and a perfectly tool-capable
               * provider would be reported as unverified. One button click,
               * rarely pressed: the headroom costs nothing worth saving.
               */
              maxTokens: 4096,
              /*
               * A connection test is a person waiting on a verdict, not a
               * chat turn worth saving. The default ten-attempt ladder would
               * make "your base URL is unreachable" — the answer this button
               * exists to give — take the better part of a minute to arrive.
               * One retry still absorbs a single blip.
               */
              /*
               * The retry ladder only fires on retryable errors, so the
               * fallback attempt below costs one extra round trip rather than
               * a second ladder — except against an unreachable host, which
               * is why the fallback takes no retries of its own.
               */
              requestRetries: withTools ? 1 : 0,
              llmProviderConfig: llmProviderConfig,
              ...(provider.additionalParams
                ? { additionalParams: provider.additionalParams }
                : {}),
            });
          };

          let testResponse: LLMCompletionResponse | null = null;
          let toolsOfferFailed: boolean = false;

          try {
            /*
             * Ask of the provider what Ask AI actually asks of it, not just
             * "are you reachable". Every OneUptime AI feature reads the
             * user's data exclusively through tools, so a model or endpoint
             * that holds a conversation but cannot call one is unusable for
             * all of them — and the way that surfaces to the user is the
             * assistant insisting it has no tool for what they asked, which
             * reads as a missing feature rather than a misconfigured
             * provider. This button is the only place an operator gets a
             * verdict, so it has to test the capability the product depends
             * on.
             */
            testResponse = await runTestCompletion(true);
          } catch (err) {
            /*
             * Some OpenAI-compatible backends reject an unknown `tools` field
             * outright. Falling back to the original tool-less prompt keeps
             * this button answering the question it has always answered —
             * "is my API key, model and base URL right?" — instead of
             * reporting a broken connection for a provider that merely
             * cannot call tools. Only if THAT fails too is the provider
             * genuinely unreachable.
             */
            logger.error(err);

            try {
              testResponse = await runTestCompletion(false);
              toolsOfferFailed = true;
            } catch (retryErr) {
              logger.error(retryErr);

              /*
               * Surface the provider's own error (bad key, unknown model,
               * unreachable base URL, etc.) so the user can fix their config.
               */
              const providerMessage: string =
                retryErr instanceof Exception
                  ? retryErr.message
                  : "Failed to connect to the LLM provider. Please verify the API key, model name, and base URL.";

              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  `LLM Provider test failed: ${providerMessage.substring(0, 1000)}`,
                ),
              );
            }
          }

          /*
           * A missing tool call is a warning, never a failure: a provider can
           * be perfectly well configured for everything except tool calling,
           * and refusing to certify it would block a working setup. Saying
           * nothing would be worse — the operator would leave believing Ask
           * AI works, and find out only when it tells a user it has no tool.
           */
          const calledTheTestTool: boolean =
            !toolsOfferFailed &&
            Boolean(
              testResponse?.toolCalls?.some((toolCall: LLMToolCall) => {
                return toolCall.name === CONNECTION_TEST_TOOL.name;
              }),
            );

          /*
           * A reply that ran into the output cap proves nothing either way:
           * the model may have been about to call the tool. Report that as
           * undetermined rather than sending the operator off to replace a
           * model that may be entirely capable.
           */
          const wasTruncated: boolean =
            !calledTheTestTool && testResponse?.stopReason === "length";

          let message: string =
            "Connection successful. The LLM provider responded to a test prompt and used tool calling.";

          if (wasTruncated) {
            message =
              "Connection successful, but tool calling could not be determined — the reply hit the output limit before any tool call appeared. This says nothing either way about the model; try the test again.";
          } else if (!calledTheTestTool) {
            const why: string = toolsOfferFailed
              ? "the test request that offered a tool failed, and only a plain prompt succeeded"
              : "the model answered in prose instead of calling the tool it was offered";

            message = `Connection successful, but tool calling could not be verified — ${why}. OneUptime's AI features (Ask AI, investigations) read your data through tools, so a provider that cannot call them will answer that it has no tool for the question. Check that this model and endpoint support tool/function calling.`;
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            supportsToolCalling: calledTheTestTool,
            message: message,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
