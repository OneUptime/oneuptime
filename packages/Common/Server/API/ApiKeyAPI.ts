import UserMiddleware from "../Middleware/UserAuthorization";
import ApiKeyService, {
  MadeApiKey,
  Service as ApiKeyServiceType,
} from "../Services/ApiKeyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ApiKey from "../../Models/DatabaseModels/ApiKey";
import {
  RESET_API_KEY_PATH,
  toResetApiKeyAnswerJSON,
} from "../../Types/ApiKey/ApiKeyShownOnce";
import ObjectID from "../../Types/ObjectID";

/*
 * A project's API keys (Project Settings > Advanced > API Keys): the CRUD
 * routes of /api-key, and the reset of a key (#8902).
 *
 * A key is stored as its hash, so it is answered once, when it is made
 * (Types/ApiKey/ApiKeyShownOnce): the create's answer holds it - BaseAPI
 * answers the record ApiKeyService.create hands back, the key in it - and
 * so does the reset's. Neither answer may be kept by a cache.
 *
 * Registered once, where the routes of /api-key used to be registered twice
 * (the second registration answered nothing: the first one's routes matched
 * first).
 */
export default class ApiKeyAPI extends BaseAPI<ApiKey, ApiKeyServiceType> {
  public constructor() {
    super(ApiKey, ApiKeyService);

    /*
     * POST /api-key/:id/reset-key - a new key in place of the key's current
     * one, which stops working, answered once. A signed-in member, or an
     * API key, who may change the key (ApiKeyService.resetApiKey): a script
     * may rotate a key it holds.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${RESET_API_KEY_PATH}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.resetApiKey(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // The create's answer holds the new key: no cache may keep it.
  protected override async onBeforeCreate(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<any> {
    res.setHeader("Cache-Control", "no-store");

    return await super.onBeforeCreate(req, res);
  }

  @CaptureSpan()
  public async resetApiKey(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();

    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);

    const made: MadeApiKey = await ApiKeyService.resetApiKey({
      id: new ObjectID(idParam),
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    });

    res.setHeader("Cache-Control", "no-store");

    return Response.sendJsonObjectResponse(
      req,
      res,
      toResetApiKeyAnswerJSON(made),
    );
  }
}
