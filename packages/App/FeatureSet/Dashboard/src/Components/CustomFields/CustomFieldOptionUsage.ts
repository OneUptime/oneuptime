import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  CustomFieldOptionUsage,
  readCustomFieldOptionUsage,
} from "Common/Types/CustomField/CustomFieldOptionEdit";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * How many of the project's records hold each value of a dropdown custom
 * field, and which fields copy it: POST /<definition route>/:id/option-usage
 * (CustomFieldDefinitionAPI, #4564), what the option editor says renaming or
 * taking out an option touches.
 *
 * The route is written out here so the tenant-header sweep
 * (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see the
 * call reaches it; the tenant header tells the server which project the
 * counts are of.
 */
export const fetchCustomFieldOptionUsage: (data: {
  // The custom field definition model: IncidentCustomField, ...
  modelType: DatabaseBaseModelType;
  fieldId: ObjectID;
}) => Promise<CustomFieldOptionUsage> = async (data: {
  modelType: DatabaseBaseModelType;
  fieldId: ObjectID;
}): Promise<CustomFieldOptionUsage> => {
  const model: BaseModel = new data.modelType();
  const apiPath: Route | null = model.getCrudApiPath();

  if (!apiPath) {
    throw new BadDataException(
      `${model.singularName || "This model"} has no API to count values with.`,
    );
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(apiPath)
        .addRoute(`/${data.fieldId.toString()}/option-usage`),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readCustomFieldOptionUsage(response.data);
};
