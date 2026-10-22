import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ArchivableValueUsage, {
  ArchivableValueUsageItem,
} from "Common/Types/ArchivableValue/ArchivableValueUsage";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What uses a value, and what deleting it would do to each: POST
 * /<value route>/:id/usage (ArchivableValueAPI). The Archive and Delete
 * dialogs ask it before they open.
 *
 * The route is written out here so the tenant-header sweep
 * (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see the
 * call reaches it; the tenant header tells the server which project the
 * counts are of.
 */
export const fetchArchivableValueUsage: (data: {
  // The value's model: IncidentSeverity, Label, ...
  modelType: DatabaseBaseModelType;
  valueId: ObjectID;
}) => Promise<Array<ArchivableValueUsageItem>> = async (data: {
  modelType: DatabaseBaseModelType;
  valueId: ObjectID;
}): Promise<Array<ArchivableValueUsageItem>> => {
  const model: BaseModel = new data.modelType();
  const apiPath: Route | null = model.getCrudApiPath();

  if (!apiPath) {
    throw new BadDataException(
      `${model.singularName || "This model"} has no API to count its uses with.`,
    );
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(apiPath)
        .addRoute(`/${data.valueId.toString()}/usage`),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return ArchivableValueUsage.fromJSONArray(
    (response.data as JSONObject | undefined)?.["usage"],
  );
};
