import DataSecurityCustomDataType from "../../Models/DatabaseModels/DataSecurityCustomDataType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DESCRIBE_DATA_TYPE_ROUTE } from "../../Types/DataSecurity/DataTypeDescribe";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { toCustomDataTypeFormValues } from "../../Utils/DataSecurity/DataTypeProposal";
import UserMiddleware from "../Middleware/UserAuthorization";
import DataSecurityCustomDataTypeService, {
  Service as DataSecurityCustomDataTypeServiceType,
} from "../Services/DataSecurityCustomDataTypeService";
import DataTypeFromSentence, {
  DescribedDataType,
} from "../Utils/AI/DataSecurity/DataTypeFromSentence";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * A project's own data types: their CRUD, and
 *
 *   POST /data-security-custom-data-type/draft-with-ai   Describe It (#10371):
 *        OneUptime AI drafts a data type from a sentence and the shapes of
 *        the person's examples, for the data type form to fill itself in
 *        with. Nothing is saved: the form saves, through the same checks
 *        as a type written by hand.
 *
 * Asking takes the permission to create data types - the form is the
 * create form - and AI on for the project (DataTypeFromSentence). The
 * examples never come here: the browser sends their shapes, and a request
 * that sends anything else as one is refused.
 */
export default class DataSecurityCustomDataTypeAPI extends BaseAPI<
  DataSecurityCustomDataType,
  DataSecurityCustomDataTypeServiceType
> {
  public constructor() {
    super(DataSecurityCustomDataType, DataSecurityCustomDataTypeService);

    this.router.post(
      DESCRIBE_DATA_TYPE_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.DataSecurity),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanCreateTable({
            modelType: DataSecurityCustomDataType,
            props,
            errorMessage:
              "Describing a data type takes a role that can create data types.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};
          const described: DescribedDataType = await DataTypeFromSentence.draft({
            projectId,
            userId: props.userId,
            sentence: body["sentence"],
            exampleShapes: body["exampleShapes"],
          });

          return Response.sendJsonObjectResponse(req, res, {
            dataType: toCustomDataTypeFormValues(described.draft),
            reason: described.reason,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
