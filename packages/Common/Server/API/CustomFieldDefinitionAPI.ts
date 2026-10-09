import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomFieldOptionCopier,
  CustomFieldOptionUsage,
  CustomFieldOptionUsageValue,
} from "../../Types/CustomField/CustomFieldOptionEdit";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import { getCustomFieldOptionUsage } from "../Utils/CustomField/CustomFieldOptionEditHooks";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * The CRUD API of a custom field definition table - one per resource:
 * /incident-custom-field, /monitor-custom-field and the other seven - plus
 * what the dashboard's option editor asks while a dropdown field is edited
 * (issue #4564):
 *
 *   POST (or GET) /<route>/:id/option-usage
 *     -> { values: [{ value, count }], copiedBy: [{ resource, fieldName }] }
 *
 * `values` is how many of the project's records hold each value of the
 * field, the most held first - the options and any value that is no longer
 * one - so the editor can say what renaming or removing an option touches.
 * `copiedBy` names the fields of other resources that copy this field's
 * value (an incident field copying a monitor field), whose options follow
 * this field's renames. It takes what editing the field takes: see
 * getCustomFieldOptionUsage.
 */
export const CUSTOM_FIELD_OPTION_USAGE_ROUTE: string = "/option-usage";

export default class CustomFieldDefinitionAPI<
  TBaseModel extends BaseModel,
  TBaseService extends DatabaseService<BaseModel>,
> extends BaseAPI<TBaseModel, TBaseService> {
  public constructor(type: { new (): TBaseModel }, service: TBaseService) {
    super(type, service);

    const route: string = `${new this.entityType()
      .getCrudApiPath()
      ?.toString()}/:id${CUSTOM_FIELD_OPTION_USAGE_ROUTE}`;

    const handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await this.getOptionUsage(req, res);
      } catch (error) {
        next(error);
      }
    };

    this.router.post(route, UserMiddleware.getUserMiddleware, handler);
    this.router.get(route, UserMiddleware.getUserMiddleware, handler);
  }

  private async getOptionUsage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const usage: CustomFieldOptionUsage = await getCustomFieldOptionUsage({
      definitionModelType: this.entityType,
      definitionService: this.service,
      fieldId: new ObjectID(idParam),
      props: props,
    });

    const body: JSONObject = {
      values: usage.values.map(
        (value: CustomFieldOptionUsageValue): JSONObject => {
          return { value: value.value, count: value.count };
        },
      ),
      copiedBy: usage.copiedBy.map(
        (copier: CustomFieldOptionCopier): JSONObject => {
          return { resource: copier.resource, fieldName: copier.fieldName };
        },
      ),
    };

    Response.setNoCacheHeaders(res);
    return Response.sendJsonObjectResponse(req, res, body);
  }
}
