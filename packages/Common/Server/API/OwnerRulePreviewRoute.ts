import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import OwnerRulePreview, {
  OWNER_RULE_PREVIEW_ROUTE,
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "../../Types/Rules/OwnerRulePreview";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import OwnerRulePreviewBuilder from "../Utils/Rules/OwnerRulePreviewBuilder";
import CommonAPI from "./CommonAPI";

/*
 * POST /<event>/owner-rule-preview: which owner rules would run for an
 * incident, alert or episode being created, and who they would add
 * (Types/Rules/OwnerRulePreview, Server/Utils/Rules/OwnerRulePreviewBuilder).
 * A POST because the event being created travels in the body.
 *
 * Registered by each event's API on its own router, behind the same guards
 * as the subscriber audience next to it: a request with no session is
 * answered 401, so an idle tab refreshes it rather than showing an error.
 * The project is the request's tenant; a project API key is admitted like a
 * member, its permissions deciding, and has no creator.
 */
export default class OwnerRulePreviewRoute {
  public static register(data: {
    router: ExpressRouter;
    // The event API's own path, "/incident".
    apiPath: string;
    event: OwnerRulePreviewEvent;
  }): void {
    data.router.post(
      `${data.apiPath}${OWNER_RULE_PREVIEW_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await OwnerRulePreviewRoute.handle(req, res, data.event);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
    event: OwnerRulePreviewEvent,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    OwnerRulePreviewBuilder.assertCallerMayPreview({
      props: props,
      event: event,
    });

    const draft: OwnerRulePreviewDraft = OwnerRulePreviewBuilder.parseDraft({
      body: req.body,
      event: event,
    });

    const result: OwnerRulePreviewResult = await OwnerRulePreviewBuilder.build({
      event: event,
      projectId: projectId,
      props: props,
      draft: draft,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      OwnerRulePreview.resultToJSON(result),
    );
  }
}
