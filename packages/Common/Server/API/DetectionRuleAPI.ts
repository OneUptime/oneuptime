import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import DetectionRuleService, {
  Service as DetectionRuleServiceType,
} from "../Services/DetectionRuleService";
import DetectionRuleDraft, {
  DetectionRuleDraftResult,
} from "../Utils/AI/Security/DetectionRuleDraft";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Detection rules: their CRUD, and
 *
 *   POST /detection-rule/draft-with-ai   OneUptime AI writes a rule's Sigma
 *                                        YAML from a description
 *
 * The draft is for the Detection Rules form, which fills its YAML with it
 * for the person to read and save; nothing is saved here. Asking takes the
 * permission to create detection rules - the form is the create form - and
 * AI on for the project (DetectionRuleDraft).
 */
export default class DetectionRuleAPI extends BaseAPI<
  DetectionRule,
  DetectionRuleServiceType
> {
  public constructor() {
    super(DetectionRule, DetectionRuleService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/draft-with-ai`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanCreateTable({
            modelType: DetectionRule,
            props,
            errorMessage:
              "Drafting a detection rule takes a role that can create detection rules.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const description: string =
            typeof body["description"] === "string"
              ? (body["description"] as string)
              : "";

          const draft: DetectionRuleDraftResult =
            await DetectionRuleDraft.draft({
              projectId,
              userId: props.userId,
              description,
            });

          return Response.sendJsonObjectResponse(req, res, {
            sigmaRuleYaml: draft.sigmaRuleYaml,
            title: draft.title,
            isCorrelation: draft.isCorrelation,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
